import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledGroupedWithConcurrency,
  insertEventStatesWithConflictResolution,
  buildEventStateInsertRow,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
  createGoogleUserRateLimiter,
  createCalDAVAccountRateLimiter,
  createHostRateLimiter,
  createOutlookAccountSemaphore,
  isCalDAVProvider,
  isHostedCalDAVProvider,
  ensureValidToken,
  isTimeoutError,
  buildCalendarBackoffState,
  buildReauthenticationDemandFields,
  resolveReauthenticationDemandAction,
  SOURCE_INGEST_LOCK_NAMESPACE,
  createRequiredSourceRanges,
  createSourceIngestionPlan,
  measureRedisCommand,
  measureSegment,
  recordSegment,
} from "@keeper.sh/calendar";
import {
  INGEST_SOURCE_TIMEOUT_MS,
  INGEST_UNADJUDICABLE_REAUTHENTICATION_SOURCES,
  PROVIDER_INGEST_REQUEST_TIMEOUT_MS,
  REAUTHENTICATION_SOURCE_INGEST,
} from "@keeper.sh/constants";
import type { SemaphoreLease } from "@keeper.sh/calendar";
import type { IngestionResult } from "@keeper.sh/calendar";
import type { CalendarBackoffState, IngestWideEventFields, IngestionFetchEventsResult, IngestionPersistenceWork, OutlookAccountSemaphore, RedisLeaseClient, RedisRateLimiter, RequiredSourceRanges, TokenState } from "@keeper.sh/calendar";
import {
  createIcsSourceFetcher,
  interpretFullDayTimedEventsAsAllDay,
  persistCalendarSnapshot,
} from "@keeper.sh/calendar/ics";
import { createGoogleSourceFetcher } from "@keeper.sh/calendar/google";
import { createOutlookSourceFetcher } from "@keeper.sh/calendar/outlook";
import {
  CalDAVIncompleteMultiGetError,
  CalDAVUnreadableResourceError,
  createCalDAVSourceFetcher,
  createCalendarDiscoveryCache,
} from "@keeper.sh/calendar/caldav";
import { decryptPassword, resolveDatabaseErrorClassification } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
  userSubscriptionsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import {
  database,
  flushDatabase,
  refreshLockRedis,
  refreshLockStore,
} from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import {
  resolveMissingCalendarFailure,
  shouldTreatAsProviderAuthFailure,
} from "@/utils/provider-ingest-failure";
import {
  hasErrorFlag,
  isIngestInfrastructureError,
  requiresReauthentication,
} from "@/utils/error-flags";
import { resolveOAuthIngestionState } from "@/utils/oauth-ingestion-state";
import { withAbortTimeout } from "@/utils/with-abort-timeout";
import { createSyncLock } from "@keeper.sh/sync";
import { enqueueDestinationSyncsForUsers } from "@/utils/enqueue-destination-syncs";
import { deleteEventStatesInChunks } from "@/utils/delete-event-states";
import { selectIngestWideEventFields } from "@/utils/ingest-wide-event";
import { estimateIngestWeight } from "@/utils/ingest-weight";
import { fleetIngestLane, pushIngestLane } from "@/utils/ingest-lanes";
import type { IngestFlushReservation, IngestLane } from "@/utils/ingest-lanes";

const SOURCE_TIMEOUT_MS = INGEST_SOURCE_TIMEOUT_MS;
const SOURCE_TIMEOUT_DATABASE_GRACE_MS = 5000;

/*
 * The same (namespace, calendarId) lock is held minutes-scale by sync-user write-back and
 * the API caldav persist, so a contended calendar must fail ITS flush quickly instead of
 * parking every queued flush behind it while it holds the single serial writer slot.
 */
const ADVISORY_LOCK_WAIT_BOUND_MS = 5000;
const UNBOUNDED_USER_GROUPS = 100_000;
const USER_GROUP_CONCURRENCY = UNBOUNDED_USER_GROUPS;
const USER_CALENDAR_CONCURRENCY = UNBOUNDED_USER_GROUPS;
const ICS_CALENDAR_CONCURRENCY = 8;

/*
 * ICS keeps a dedicated group budget: parsing is CPU-bound and starves the Bun event loop
 * when run wide open — observed 2026-08-17, when a parse took 30,133ms.
 *
 * What bounds the loop is parse-seconds in flight, not calendars in flight, and that parse
 * is now 457ms. The 2026-08-17 budget of 4x2 held 241 parse-seconds; 16x8 holds 59, so the
 * wider budget still sits four times under the occupancy that caused the incident.
 */
const ICS_PARSE_CONCURRENCY = 16;
const SOURCE_INGEST_LOCK_KEY_PREFIX = "source-ingest:";

/*
 * Every lock round trip is timed so "the lock was held" and "Redis was slow" stay
 * distinguishable; redis.command_ms_max is an overlay on wait.source_lock_ms, never
 * a segment of its own.
 */
const instrumentedLockRedis = {
  eval: (script: string, keyCount: number, ...parameters: string[]): Promise<unknown> =>
    measureRedisCommand(() => refreshLockRedis.eval(script, keyCount, ...parameters)),
  get: (key: string): Promise<string | null> =>
    measureRedisCommand(() => refreshLockRedis.get(key)),
};

/*
 * An overlapping pass is a routine identical run, not a mapping mutation, so it must
 * acquire as "background" to keep IS_CURRENT true for the in-flight holder. Under the
 * default "preempting" class every overlap discarded the holder's finished work, and a
 * source slower than its deadline never recorded its first ingest.
 */
const sourceIngestLock = createSyncLock(instrumentedLockRedis, "background");

/*
 * The ioredis set overloads type expiry/condition tokens positionally, so the
 * semaphore's variadic option list has to go through the generic command runner.
 */
const leaseLockRedis: RedisLeaseClient = {
  del: (...keys: string[]): Promise<number> => refreshLockRedis.del(...keys),
  set: (key: string, value: string, ...options: string[]): Promise<string | null> =>
    refreshLockRedis.call("set", key, value, ...options) as Promise<string | null>,
};

/*
 * The lane gate, not the driver pool: a lane owns a fixed slice of the pool's connections,
 * so its occupancy is what a source actually competed for, and a query admitted with no
 * free permit is the one that paid for the contention.
 */
const countQueuedQuery = (hasFreePermit: boolean): number => {
  if (hasFreePermit) {
    return 0;
  }
  return 1;
};

const runPooledQuery = async <TResult>(
  lane: IngestLane,
  statement: () => PromiseLike<TResult>,
): Promise<TResult> => {
  widelog.count("database.queries.count", 1);
  widelog.count(
    "database.queries.queued_count",
    countQueuedQuery(lane.pooledQueryGate.hasFreePermit()),
  );
  return await lane.pooledQueryGate.run(async () => {
    widelog.max("database.pool.in_flight", lane.pooledQueryGate.inFlight());
    return await statement();
  });
};

const measureDatabaseRead = async <TResult>(
  lane: IngestLane,
  read: () => PromiseLike<TResult>,
): Promise<TResult> => {
  widelog.count("db.read_count", 1);
  return await measureSegment(
    "work.db_read_ms",
    async () => await runPooledQuery(lane, read),
  );
};

const measureDatabaseWrite = async <TResult>(
  lane: IngestLane,
  write: () => PromiseLike<TResult>,
): Promise<TResult> => {
  widelog.count("db.write_count", 1);
  return await measureSegment(
    "work.db_write_ms",
    async () => await runPooledQuery(lane, write),
  );
};

const resetIngestBackoff = async (lane: IngestLane, calendarId: string): Promise<void> => {
  await measureDatabaseWrite(lane, () => database
    .update(calendarsTable)
    .set({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    })
    .where(eq(calendarsTable.id, calendarId)));
};

const applyIngestBackoff = async (
  lane: IngestLane,
  calendarId: string,
  currentFailureCount: number,
): Promise<CalendarBackoffState> => {
  const state = buildCalendarBackoffState(currentFailureCount);
  await measureDatabaseWrite(lane, () => database
    .update(calendarsTable)
    .set({
      ingestFailureCount: state.failureCount,
      ingestLastFailureAt: state.lastFailureAt,
      ingestNextAttemptAt: state.nextAttemptAt,
    })
    .where(eq(calendarsTable.id, calendarId)));
  return state;
};

const logIngestBackoff = (state: CalendarBackoffState): void => {
  widelog.set("retry.failure_count", state.failureCount);
  if (state.nextAttemptAt) {
    widelog.set("retry.next_attempt_at", state.nextAttemptAt.toISOString());
  }
};

/*
 * Runs after the work has committed, so a Redis blip in the probe or a failed write must
 * never clobber the committed result with a rejection, nor feed the backoff escalator.
 */
const resetIngestBackoffIfCurrent = async (
  lane: IngestLane,
  calendarId: string,
  isCurrent: () => Promise<boolean>,
): Promise<void> => {
  try {
    if (await isCurrent()) {
      await resetIngestBackoff(lane, calendarId);
    }
  } catch (error) {
    widelog.errorFields(error, {
      slug: "ingest-backoff-reset-failed",
      retriable: true,
    });
  }
};

const runSourceIngest = async <TResult>(
  lane: IngestLane,
  calendarId: string,
  signal: AbortSignal,
  work: (isCurrent: () => Promise<boolean>) => Promise<TResult>,
  shouldApplyBackoff: (error: unknown) => boolean,
): Promise<TResult | null> => {
  const lockResult = await measureSegment("wait.source_lock_ms", () => sourceIngestLock.acquire(
    `${SOURCE_INGEST_LOCK_KEY_PREFIX}${calendarId}`,
    signal,
  ));
  widelog.set("ingest.lock_acquired", lockResult.acquired);
  if (!lockResult.acquired) {
    signal.throwIfAborted();
    return null;
  }
  try {
    const [attempt] = await measureDatabaseRead(lane, () => database
      .select({
        failureCount: calendarsTable.ingestFailureCount,
        nextAttemptAt: calendarsTable.ingestNextAttemptAt,
      })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId))
      .limit(1));
    if (!attempt || attempt.nextAttemptAt && attempt.nextAttemptAt > new Date()) {
      return null;
    }
    try {
      const result = await work(lockResult.handle.isCurrent);
      if (attempt.failureCount > 0) {
        await resetIngestBackoffIfCurrent(lane, calendarId, lockResult.handle.isCurrent);
      }
      return result;
    } catch (error) {
      if (shouldApplyBackoff(error)) {
        logIngestBackoff(await applyIngestBackoff(lane, calendarId, attempt.failureCount));
      }
      throw error;
    }
  } finally {
    /* The lock TTL already reclaims the hold, so a failed release must not reject. */
    await lockResult.handle.release().catch((error: unknown) => {
      widelog.errorFields(error, {
        slug: "source-lock-release-failed",
        retriable: true,
      });
    });
  }
};

const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const recordSkippedResources = (skippedResourceCount: number, reasons: string[]): void => {
  if (skippedResourceCount === 0) {
    return;
  }
  widelog.set("provider.resources_skipped", skippedResourceCount);
  widelog.set("provider.resources_skipped_reasons", reasons.join("; "));
};

const resolveDatabaseIngestErrorSlug = (error: unknown): string | null => {
  const databaseError = resolveDatabaseErrorClassification(error);
  if (!databaseError) {
    return null;
  }
  if (databaseError.sqlState) {
    widelog.set("db.error_sqlstate", databaseError.sqlState);
  }
  return databaseError.slug;
};

const resolveIngestErrorSlug = (error: unknown): string => {
  const databaseErrorSlug = resolveDatabaseIngestErrorSlug(error);
  if (databaseErrorSlug) {
    return databaseErrorSlug;
  }
  if (error instanceof CalDAVIncompleteMultiGetError) {
    return "provider-response-incomplete";
  }
  if (error instanceof CalDAVUnreadableResourceError) {
    recordSkippedResources(error.skippedResourceCount, error.skippedResourceReasons);
    return "provider-partial-response";
  }
  if (!isTimeoutError(error)) {
    return "provider-api-error";
  }
  widelog.set("timeout.fired", true);
  widelog.set("timeout.kind", "request");
  widelog.set("timeout.limit_ms", PROVIDER_INGEST_REQUEST_TIMEOUT_MS);
  return "provider-request-timeout";
};

/*
 * A queued transaction's callback runs in the async context of whoever released the
 * connection (see packages/database/src/utils/pool-telemetry.ts), so nothing inside it may
 * call widelog. Measured here and emitted once the transaction resolves, back in context.
 */
interface PersistenceLedger {
  advisoryLockMs: number;
  callbackReturnedAt: number;
  grantedAt: number;
  readCount: number;
  readMs: number;
  writeCount: number;
  writeMs: number;
}

const createPersistenceLedger = (): PersistenceLedger => ({
  advisoryLockMs: 0,
  callbackReturnedAt: 0,
  grantedAt: 0,
  readCount: 0,
  readMs: 0,
  writeCount: 0,
  writeMs: 0,
});

const measureLedgerRead = async <TResult>(
  ledger: PersistenceLedger,
  statement: () => PromiseLike<TResult>,
): Promise<TResult> => {
  const startedAt = performance.now();
  try {
    return await statement();
  } finally {
    ledger.readMs += performance.now() - startedAt;
  }
};

const measureLedgerWrite = async <TResult>(
  ledger: PersistenceLedger,
  statement: () => PromiseLike<TResult>,
): Promise<TResult> => {
  const startedAt = performance.now();
  try {
    return await statement();
  } finally {
    ledger.writeMs += performance.now() - startedAt;
  }
};

const emitPersistenceLedger = (ledger: PersistenceLedger, requestedAt: number): void => {
  /* Pool exhaustion is the case this exists to catch, so the wait is charged regardless. */
  if (ledger.grantedAt === 0) {
    recordSegment("wait.db_pool_ms", performance.now() - requestedAt);
    return;
  }
  recordSegment("wait.db_pool_ms", ledger.grantedAt - requestedAt);
  recordSegment("wait.advisory_lock_ms", ledger.advisoryLockMs);
  if (ledger.readCount > 0) {
    widelog.count("db.read_count", ledger.readCount);
    recordSegment("work.db_read_ms", ledger.readMs);
  }
  if (ledger.writeCount > 0) {
    widelog.count("db.write_count", ledger.writeCount);
    recordSegment("work.db_write_ms", ledger.writeMs);
  }
  const releasedAt = performance.now();
  const slotOccupancyMs = releasedAt - ledger.grantedAt;
  widelog.set("flush.slot_occupancy_ms", Math.round(slotOccupancyMs));
  let commitMs = 0;
  if (ledger.callbackReturnedAt > 0) {
    commitMs = releasedAt - ledger.callbackReturnedAt;
    recordSegment("work.db_commit_ms", commitMs);
  }
  const accountedMs = ledger.advisoryLockMs + ledger.readMs + ledger.writeMs + commitMs;
  /*
   * Overlaps the segments it is derived from, so it is an overlay: a segment here would be
   * double-counted by the accounted_ms rollup.
   */
  widelog.set("flush.unattributed_ms", Math.round(Math.max(0, slotOccupancyMs - accountedMs)));
};

/* The wait is its own segment so "the budget was full" never masquerades as rate limiting. */
const reserveIngestFlushWeight = async (
  lane: IngestLane,
  calendarId: string,
  hasEverIngested: boolean,
  signal: AbortSignal,
): Promise<IngestFlushReservation> => {
  const weight = await estimateIngestWeight(
    {
      countStoredEvents: async (targetCalendarId: string): Promise<number> => {
        const rows = await measureDatabaseRead(lane, () => database
          .select({ count: count() })
          .from(eventStatesTable)
          .where(eq(eventStatesTable.calendarId, targetCalendarId)));
        return rows[0]?.count ?? 0;
      },
    },
    calendarId,
    hasEverIngested,
  );
  const reservation = await measureSegment(
    "wait.flush_reserve_ms",
    () => lane.flushWriter.reserve(weight, signal),
  );
  const depth = lane.flushWriter.depth();
  widelog.set("flush.queued_flushes", depth.queuedFlushes);
  widelog.set("flush.parked_on_budget", depth.parkedOnBudget);
  widelog.set("flush.writer_slots_in_use", depth.writerSlotsInUse);
  return reservation;
};

const createIngestionPersistenceTransaction = (
  calendarId: string,
  signal: AbortSignal,
  deadlineAt: number,
  reservation: IngestFlushReservation,
) =>
  (work: IngestionPersistenceWork) => {
    const ledger = createPersistenceLedger();
    const requestedAt = performance.now();
    /* Carries the source's own deadline so a wedged run is not bounded by the generic fallback. */
    return reservation.submit(Object.assign(() => flushDatabase.transaction(async (transaction) => {
    ledger.grantedAt = performance.now();
    const setRemainingStatementTimeout = async (): Promise<void> => {
      signal.throwIfAborted();
      const remainingMs = Math.max(1, Math.ceil(deadlineAt - Date.now()));
      await transaction.execute(
        sql`select set_config('statement_timeout', ${String(remainingMs)}, true)`,
      );
      signal.throwIfAborted();
    };

    const initialRemainingMs = Math.max(1, Math.ceil(deadlineAt - Date.now()));
    await transaction.execute(sql`select set_config(
      'idle_in_transaction_session_timeout',
      ${String(initialRemainingMs + SOURCE_TIMEOUT_DATABASE_GRACE_MS)},
      true
    )`);
    /*
     * A small constant, never the source's full remaining deadline: the lock can be held
     * minutes-scale elsewhere while this transaction occupies the single serial writer slot.
     */
    const boundedLockWaitMs = Math.max(
      1,
      Math.min(ADVISORY_LOCK_WAIT_BOUND_MS, Math.ceil(deadlineAt - Date.now())),
    );
    signal.throwIfAborted();
    await transaction.execute(
      sql`select set_config('statement_timeout', ${String(boundedLockWaitMs)}, true)`,
    );
    const advisoryLockRequestedAt = performance.now();
    try {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
      );
    } finally {
      ledger.advisoryLockMs += performance.now() - advisoryLockRequestedAt;
    }
    signal.throwIfAborted();
    await setRemainingStatementTimeout();

    const result = await work({
      readExistingEvents: async () => {
        await setRemainingStatementTimeout();
        ledger.readCount += 1;
        const events = await measureLedgerRead(ledger, () => transaction.select({
          availability: eventStatesTable.availability,
          description: eventStatesTable.description,
          endTime: eventStatesTable.endTime,
          exceptionDates: eventStatesTable.exceptionDates,
          id: eventStatesTable.id,
          isAllDay: eventStatesTable.isAllDay,
          location: eventStatesTable.location,
          recurrenceId: eventStatesTable.recurrenceId,
          recurrenceRule: eventStatesTable.recurrenceRule,
          sourceEventId: eventStatesTable.sourceEventId,
          sourceEventType: eventStatesTable.sourceEventType,
          sourceEventUid: eventStatesTable.sourceEventUid,
          startTime: eventStatesTable.startTime,
          startTimeZone: eventStatesTable.startTimeZone,
          title: eventStatesTable.title,
        })
        .from(eventStatesTable)
          .where(eq(eventStatesTable.calendarId, calendarId)));
        signal.throwIfAborted();
        return events;
      },
      flush: async (changes) => {
        signal.throwIfAborted();
        if (changes.deletes.length > 0) {
          await setRemainingStatementTimeout();
          await measureLedgerWrite(ledger, () => deleteEventStatesInChunks(
            transaction,
            calendarId,
            changes.deletes,
            () => { ledger.writeCount += 1; },
          ));
          signal.throwIfAborted();
        }

        if (changes.inserts.length > 0) {
          await setRemainingStatementTimeout();
          await measureLedgerWrite(ledger, () => insertEventStatesWithConflictResolution(
            transaction,
            changes.inserts.map((event) => buildEventStateInsertRow(calendarId, event)),
            () => { ledger.writeCount += 1; },
          ));
          signal.throwIfAborted();
        }

        if ("syncToken" in changes) {
          await setRemainingStatementTimeout();
          ledger.writeCount += 1;
          await measureLedgerWrite(ledger, () => transaction
            .update(calendarsTable)
            .set({ syncToken: changes.syncToken })
            .where(eq(calendarsTable.id, calendarId)));
          signal.throwIfAborted();
        }

        if (changes.coverage) {
          const { futureRange, historicRange, window } = changes.coverage;
          await setRemainingStatementTimeout();
          /* The window is day-anchored, so an unconditional rewrite would churn updatedAt per tick. */
          ledger.writeCount += 1;
          await measureLedgerWrite(ledger, () => transaction
            .update(calendarsTable)
            .set({
              ingestFutureRange: futureRange,
              ingestHistoricRange: historicRange,
              ingestWindowEnd: window.timeMax,
              ingestWindowRecordedAt: new Date(),
              ingestWindowStart: window.timeMin,
            })
            .where(and(
              eq(calendarsTable.id, calendarId),
              or(
                isNull(calendarsTable.ingestWindowRecordedAt),
                isNull(calendarsTable.ingestWindowStart),
                isNull(calendarsTable.ingestWindowEnd),
                ne(calendarsTable.ingestFutureRange, futureRange),
                ne(calendarsTable.ingestHistoricRange, historicRange),
                ne(calendarsTable.ingestWindowStart, window.timeMin),
                ne(calendarsTable.ingestWindowEnd, window.timeMax),
              ),
            )));
          signal.throwIfAborted();
        }

        const { snapshot } = changes;
        if (snapshot) {
          await setRemainingStatementTimeout();
          ledger.writeCount += 1;
          await measureLedgerWrite(ledger, () =>
            persistCalendarSnapshot(transaction, calendarId, snapshot));
          signal.throwIfAborted();
        }
      },
    });
      signal.throwIfAborted();
      ledger.callbackReturnedAt = performance.now();
      return result;
    }), {
      deadlineAt,
      /*
       * Redis I/O must settle after the queue wait but BEFORE the transaction opens, so a
       * brownout never parks the sole flush connection, the advisory lock, or the writer slot.
       */
      prepare: async (): Promise<IngestionResult | null> => {
        const { preflight } = work;
        if (!preflight) {
          return null;
        }
        return await preflight();
      },
    })).finally(() => {
      /* A throw here would reject a committed transaction or mask the real ingest error. */
      try {
        emitPersistenceLedger(ledger, requestedAt);
      } catch (error) {
        widelog.errorFields(error, { retriable: false, slug: "persistence-ledger-emit" });
      }
    });
  };

const resolveTokenRefresher = (provider: string) => {
  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return createGoogleTokenRefresher({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
  }

  if (provider === "outlook" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return createMicrosoftTokenRefresher({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
  }

  return null;
};

interface RateLimiterSourceContext {
  accountId?: string;
  serverUrl?: string;
  url?: string;
  userId: string;
}

const resolveTargetHost = (target: string | null): string | null => {
  if (!target) {
    return null;
  }
  try {
    return new URL(target).hostname;
  } catch {
    return null;
  }
};

/*
 * Per-run concurrency, not per-request pacing: one ingest holds exactly one lease, and
 * pagination reuses it. The TTL outlives the ingest timeout so a crashed holder still frees.
 */
/*
 * Released eagerly rather than at the 150s TTL: an account's fourth calendar in a pass
 * would otherwise wait past its own 120s deadline for a slot nobody is going to free.
 */
interface IngestRateLimiter extends RedisRateLimiter {
  dispose?: () => Promise<void>;
}

const releaseOnceAcquired = async (
  semaphore: OutlookAccountSemaphore,
  lease: Promise<SemaphoreLease>,
): Promise<void> => {
  const acquired = await lease.then(
    (held: SemaphoreLease) => held,
    () => null,
  );
  if (acquired) {
    await semaphore.release(acquired);
  }
};

const createSemaphoreRateLimiterAdapter = (
  semaphore: OutlookAccountSemaphore,
): IngestRateLimiter => {
  let lease: Promise<SemaphoreLease> | null = null;
  return {
    acquire: async (_count: number, signal?: AbortSignal): Promise<void> => {
      if (!lease) {
        lease = measureSegment("wait.rate_limiter_ms", () => semaphore.acquireLease(signal));
      }
      await lease;
    },
    /* A deadline can fire mid-acquire, so the lease is awaited here or its slot waits out the TTL. */
    dispose: async (): Promise<void> => {
      if (!lease) {
        return;
      }
      const pending = lease;
      lease = null;
      await releaseOnceAcquired(semaphore, pending);
    },
  };
};

const resolveRateLimiter = (
  provider: string,
  source: RateLimiterSourceContext,
): IngestRateLimiter | undefined => {
  if (provider === "google") {
    return createGoogleUserRateLimiter(refreshLockRedis, source.userId, "ingest");
  }

  if (provider === "outlook") {
    if (!source.accountId) {
      return;
    }
    return createSemaphoreRateLimiterAdapter(
      createOutlookAccountSemaphore(leaseLockRedis, source.accountId),
    );
  }

  if (isCalDAVProvider(provider)) {
    if (isHostedCalDAVProvider(provider) && source.accountId) {
      return createCalDAVAccountRateLimiter(refreshLockRedis, source.accountId);
    }
    const host = resolveTargetHost(source.serverUrl ?? null);
    if (!host) {
      return;
    }
    return createHostRateLimiter(refreshLockRedis, host);
  }

  if (provider !== "ical" && provider !== "ics") {
    return;
  }
  const host = resolveTargetHost(source.url ?? null);
  if (!host) {
    return;
  }
  return createHostRateLimiter(refreshLockRedis, host);
};

const getRequiredSourceRanges = async (
  lane: IngestLane,
  sourceCalendarId: string,
): Promise<RequiredSourceRanges> => {
  const mappings = await measureDatabaseRead(lane, () => database
    .select({
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.destinationCalendarId, calendarsTable.id),
    )
    .where(and(
      eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
      eq(calendarsTable.disabled, false),
      arrayContains(calendarsTable.capabilities, ["push"]),
    )));
  return createRequiredSourceRanges(mappings);
};

const hasSourceAuthorityChanged = (
  source: {
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestWindowRecordedAt: Date | null;
  },
  required: RequiredSourceRanges,
): boolean => source.ingestWindowRecordedAt === null
  || source.ingestHistoricRange !== required.historicRange
  || source.ingestFutureRange !== required.futureRange;

interface OAuthFetcherParams {
  accessToken: string;
  calendarId: string;
  externalCalendarId: string;
  syncToken: string | null;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  plan: ReturnType<typeof createSourceIngestionPlan>;
}

const resolveOAuthFetcher = (
  provider: string,
  params: OAuthFetcherParams,
): { fetchEvents: () => Promise<IngestionFetchEventsResult> } | null => {
  if (provider === "google") {
    return createGoogleSourceFetcher(params);
  }
  if (provider === "outlook") {
    return createOutlookSourceFetcher(params);
  }
  return null;
};

type ReauthenticationDemand =
  | "credential-rejected"
  | "authenticated"
  | "request-rejected"
  | "abstain";

type AuthenticationRejection = Extract<
  ReauthenticationDemand,
  "credential-rejected" | "request-rejected"
>;

const REAUTHENTICATION_DEMAND_PRECEDENCE: ReauthenticationDemand[] = [
  "credential-rejected",
  "authenticated",
  "request-rejected",
];

interface ReauthenticationDemandRecord {
  accountId: string;
  demand: ReauthenticationDemand;
}

interface SourceAccountContext {
  accountId: string | null;
  recordedDemandSource: string | null;
}

const INGEST_UNADJUDICABLE_DEMAND_SOURCES = new Set(
  INGEST_UNADJUDICABLE_REAUTHENTICATION_SOURCES,
);

const isIngestAdjudicableDemand = (recordedDemandSource: string | null): boolean => {
  if (recordedDemandSource === null) {
    return true;
  }
  return !INGEST_UNADJUDICABLE_DEMAND_SOURCES.has(recordedDemandSource);
};

const resolveRecordedDemandSource = (needsReauthentication: boolean): string | null => {
  if (needsReauthentication) {
    return REAUTHENTICATION_SOURCE_INGEST;
  }
  return null;
};

interface IngestionSourceResult {
  eventsAdded: number;
  eventsRemoved: number;
  firstIngest: boolean;
  reauthentication: ReauthenticationDemandRecord | null;
  shouldPush: boolean;
  userId: string;
}

const resolveReauthenticationDemands = (
  demands: ReauthenticationDemandRecord[],
): Map<string, boolean> => {
  const castByAccount = new Map(
    [...new Set(demands.map(({ accountId }) => accountId))].map((
      accountId,
    ): [string, Set<ReauthenticationDemand>] => [
      accountId,
      new Set(
        demands
          .filter((record) => record.accountId === accountId)
          .map(({ demand }) => demand),
      ),
    ]),
  );
  return new Map(
    [...castByAccount].flatMap(([accountId, cast]): [string, boolean][] => {
      const decisive = REAUTHENTICATION_DEMAND_PRECEDENCE.find((demand) => cast.has(demand));
      if (!decisive) {
        return [];
      }
      return [[accountId, decisive !== "authenticated"]];
    }),
  );
};

const REAUTHENTICATION_VOTE_FIELDS: [ReauthenticationDemand, string][] = [
  ["credential-rejected", "reauth.votes.credential_rejected"],
  ["authenticated", "reauth.votes.authenticated"],
  ["request-rejected", "reauth.votes.request_rejected"],
  ["abstain", "reauth.votes.abstain"],
];

const recordReauthenticationDemandVotes = (
  cast: ReauthenticationDemand[],
): ReauthenticationDemand | undefined => {
  for (const [demand, field] of REAUTHENTICATION_VOTE_FIELDS) {
    widelog.set(field, cast.filter((vote) => vote === demand).length);
  }
  const decidingVote = REAUTHENTICATION_DEMAND_PRECEDENCE.find(
    (demand) => cast.includes(demand),
  );
  if (decidingVote) {
    widelog.set("reauth.deciding_vote", decidingVote);
  }
  return decidingVote;
};

const recordReauthenticationDemandFields = (
  fields: Record<string, string | number | boolean>,
): void => {
  for (const [key, value] of Object.entries(fields)) {
    widelog.set(key, value);
  }
};

const resolvePreviousFlag = (
  transitioned: boolean,
  needsReauthentication: boolean,
): boolean => {
  if (transitioned) {
    return !needsReauthentication;
  }
  return needsReauthentication;
};

const resolveRaiseSignal = (
  needsReauthentication: boolean,
  decidingVote: ReauthenticationDemand | undefined,
): string | undefined => {
  if (!needsReauthentication || !decidingVote) {
    return;
  }
  return decidingVote;
};

const applyReauthenticationDemands = async (
  lane: IngestLane,
  demands: ReauthenticationDemandRecord[],
  recordedDemandSources: Map<string, string | null>,
): Promise<void> => {
  for (const [accountId, needsReauthentication] of resolveReauthenticationDemands(demands)) {
    const recordedDemandSource = recordedDemandSources.get(accountId) ?? null;
    const cast = demands
      .filter((record) => record.accountId === accountId)
      .map(({ demand }) => demand);
    await context(async () => {
      widelog.set("operation.name", "reauthentication-demand");
      widelog.set("operation.type", "job");
      const decidingVote = recordReauthenticationDemandVotes(cast);
      try {
        if (!needsReauthentication && !isIngestAdjudicableDemand(recordedDemandSource)) {
          recordReauthenticationDemandFields(buildReauthenticationDemandFields({
            accountId,
            action: "clear",
            previous: null,
            provenance: REAUTHENTICATION_SOURCE_INGEST,
            recordedProvenance: recordedDemandSource,
          }));
          widelog.set("reauth.suppressed", true);
          widelog.set("outcome", "skipped");
          return;
        }
        const written = await measureDatabaseWrite(lane, () => database
          .update(calendarAccountsTable)
          .set({
            needsReauthentication,
            reauthenticationSource: resolveRecordedDemandSource(needsReauthentication),
          })
          .where(and(
            eq(calendarAccountsTable.id, accountId),
            ne(calendarAccountsTable.needsReauthentication, needsReauthentication),
          ))
          .returning({ id: calendarAccountsTable.id }));
        const transitioned = written.length > 0;
        recordReauthenticationDemandFields(buildReauthenticationDemandFields({
          accountId,
          action: resolveReauthenticationDemandAction(needsReauthentication),
          previous: resolvePreviousFlag(transitioned, needsReauthentication),
          provenance: REAUTHENTICATION_SOURCE_INGEST,
          recordedProvenance: recordedDemandSource,
          signal: resolveRaiseSignal(needsReauthentication, decidingVote),
        }));
        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error, {
          retriable: true,
          slug: resolveDatabaseIngestErrorSlug(error) ?? "reauthentication-demand-write-failed",
        });
      } finally {
        widelog.flush();
      }
    });
  }
};

interface IngestionBatchResult {
  added: number;
  affectedUserIds: string[];
  errors: number;
  firstIngestUserIds: string[];
  removed: number;
}

const createSkippedIngestionResult = (userId: string): IngestionSourceResult => ({
  eventsAdded: 0,
  eventsRemoved: 0,
  firstIngest: false,
  reauthentication: null,
  shouldPush: false,
  userId,
});

const recordIngestWideEvent = (event: IngestWideEventFields): void => {
  for (const [key, value] of Object.entries(selectIngestWideEventFields(event))) {
    widelog.set(key, value);
  }
};

const createRejectedIngestionResult = (
  userId: string,
  accountId: string,
  demand: AuthenticationRejection,
): IngestionSourceResult => ({
  ...createSkippedIngestionResult(userId),
  reauthentication: { accountId, demand },
});

const collectReauthenticationDemands = (
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  accounts: SourceAccountContext[],
): ReauthenticationDemandRecord[] =>
  settlements.flatMap((settlement, index): ReauthenticationDemandRecord[] => {
    if (settlement.status === "fulfilled" && settlement.value.reauthentication) {
      return [settlement.value.reauthentication];
    }
    const accountId = accounts[index]?.accountId;
    if (!accountId) {
      return [];
    }
    return [{ accountId, demand: "abstain" }];
  });

const collectRecordedDemandSources = (
  accounts: SourceAccountContext[],
): Map<string, string | null> =>
  new Map(
    accounts.flatMap(({ accountId, recordedDemandSource }): [string, string | null][] => {
      if (!accountId) {
        return [];
      }
      return [[accountId, recordedDemandSource]];
    }),
  );

const summariseIngestionSettlements = async (
  lane: IngestLane,
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  accounts: SourceAccountContext[],
): Promise<IngestionBatchResult> => {
  const results = settlements
    .filter((settlement): settlement is PromiseFulfilledResult<IngestionSourceResult> =>
      settlement.status === "fulfilled")
    .map(({ value }) => value);

  await applyReauthenticationDemands(
    lane,
    collectReauthenticationDemands(settlements, accounts),
    collectRecordedDemandSources(accounts),
  );

  return {
    added: results.reduce((total, { eventsAdded }) => total + eventsAdded, 0),
    affectedUserIds: [
      ...new Set(results.filter(({ shouldPush }) => shouldPush).map(({ userId }) => userId)),
    ],
    errors: settlements.length - results.length,
    firstIngestUserIds: [
      ...new Set(results.filter(({ firstIngest }) => firstIngest).map(({ userId }) => userId)),
    ],
    removed: results.reduce((total, { eventsRemoved }) => total + eventsRemoved, 0),
  };
};

const createEmptyIngestionBatchResult = (): IngestionBatchResult => ({
  added: 0,
  affectedUserIds: [],
  errors: 0,
  firstIngestUserIds: [],
  removed: 0,
});

const buildOAuthSourceIdFilter = (calendarIds: string[] | undefined) => {
  if (!calendarIds) {
    return [];
  }
  return [inArray(calendarsTable.id, calendarIds)];
};

const resolveIngestTrigger = (calendarIds: string[] | undefined): string => {
  if (calendarIds) {
    return "push";
  }
  return "cron";
};

/*
 * A drain names the calendars a webhook woke, so its ingest runs in the push lane and
 * cannot be parked behind a fleet pass that has fanned out over every source.
 */
const resolveIngestLane = (calendarIds: string[] | undefined): IngestLane => {
  if (calendarIds) {
    return pushIngestLane;
  }
  return fleetIngestLane;
};

const ingestOAuthSources = async (
  calendarIds?: string[],
  correlationIdByCalendarId: Record<string, string> = {},
): Promise<IngestionBatchResult> => {
  if (calendarIds && calendarIds.length === 0) {
    return createEmptyIngestionBatchResult();
  }
  const lane = resolveIngestLane(calendarIds);

  const oauthSources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
      reauthenticationSource: calendarAccountsTable.reauthenticationSource,
      externalCalendarId: calendarsTable.externalCalendarId,
      syncToken: calendarsTable.syncToken,
      oauthCredentialId: oauthCredentialsTable.id,
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      userId: calendarsTable.userId,
      ingestFutureRange: calendarsTable.ingestFutureRange,
      ingestHistoricRange: calendarsTable.ingestHistoricRange,
      ingestWindowEnd: calendarsTable.ingestWindowEnd,
      ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
      ingestWindowStart: calendarsTable.ingestWindowStart,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .leftJoin(userSubscriptionsTable, eq(calendarsTable.userId, userSubscriptionsTable.userId))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        ...buildOAuthSourceIdFilter(calendarIds),
      ),
    )
    .orderBy(
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
    );

  const settlements = await allSettledGroupedWithConcurrency(
    oauthSources.map((source) => {
      const enqueuedAt = Date.now();
      return () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          widelog.set("ingest.trigger", resolveIngestTrigger(calendarIds));
          const inboundCorrelationId = correlationIdByCalendarId[source.calendarId] ?? "";
          if (inboundCorrelationId.length > 0) {
            widelog.set("correlation.id", inboundCorrelationId);
          }
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", source.provider);
          widelog.set("provider.account_id", source.accountId);
          widelog.set("provider.calendar_id", source.calendarId);
          if (source.externalCalendarId) {
            widelog.set("provider.external_calendar_id", source.externalCalendarId);
          }

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(lane, source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await measureDatabaseRead(lane, () => database
                  .select({
                    accountId: calendarAccountsTable.id,
                    accessToken: oauthCredentialsTable.accessToken,
                    expiresAt: oauthCredentialsTable.expiresAt,
                    externalCalendarId: calendarsTable.externalCalendarId,
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestWindowEnd: calendarsTable.ingestWindowEnd,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    ingestWindowStart: calendarsTable.ingestWindowStart,
                    oauthCredentialId: oauthCredentialsTable.id,
                    provider: calendarAccountsTable.provider,
                    refreshToken: oauthCredentialsTable.refreshToken,
                    syncToken: calendarsTable.syncToken,
                    userId: calendarsTable.userId,
                  })
                  .from(calendarsTable)
                  .innerJoin(
                    calendarAccountsTable,
                    eq(calendarsTable.accountId, calendarAccountsTable.id),
                  )
                  .innerJoin(
                    oauthCredentialsTable,
                    eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
                  )
                  .where(and(
                    eq(calendarsTable.id, source.calendarId),
                    eq(calendarsTable.disabled, false),
                    arrayContains(calendarsTable.capabilities, ["pull"]),
                  ))
                  .limit(1));
                if (!currentSource?.externalCalendarId) {
                  return createSkippedIngestionResult(source.userId);
                }

                const rawRefresher = resolveTokenRefresher(currentSource.provider);
                const tokenState: TokenState = {
                  accessToken: currentSource.accessToken,
                  accessTokenExpiresAt: currentSource.expiresAt,
                  refreshToken: currentSource.refreshToken,
                };
                if (rawRefresher) {
                  const tokenRefresher = createCoordinatedRefresher({
                    database,
                    oauthCredentialId: currentSource.oauthCredentialId,
                    calendarAccountId: currentSource.accountId,
                    refreshLockStore,
                    rawRefresh: rawRefresher,
                  });
                  await measureSegment(
                    "wait.token_refresh_ms",
                    () => ensureValidToken(tokenState, tokenRefresher),
                  );
                }

                const ranges = await getRequiredSourceRanges(lane, source.calendarId);
                const ingestionState = resolveOAuthIngestionState({
                  futureRange: currentSource.ingestFutureRange,
                  historicRange: currentSource.ingestHistoricRange,
                  syncToken: currentSource.syncToken,
                  windowEnd: currentSource.ingestWindowEnd,
                  windowRecordedAt: currentSource.ingestWindowRecordedAt,
                  windowStart: currentSource.ingestWindowStart,
                }, ranges);
                widelog.set("coverage.state", ingestionState.coverageState);
                if (ingestionState.fullSyncReason) {
                  widelog.set("full_sync.reason", ingestionState.fullSyncReason);
                }
                const rateLimiter = resolveRateLimiter(currentSource.provider, {
                  accountId: currentSource.accountId,
                  userId: currentSource.userId,
                });
                const fetcher = resolveOAuthFetcher(currentSource.provider, {
                  accessToken: tokenState.accessToken,
                  calendarId: source.calendarId,
                  externalCalendarId: currentSource.externalCalendarId,
                  syncToken: ingestionState.syncToken,
                  rateLimiter,
                  signal,
                  plan: createSourceIngestionPlan(
                    ranges.historicRange,
                    ranges.futureRange,
                  ),
                });
                if (!fetcher) {
                  return createSkippedIngestionResult(currentSource.userId);
                }
                const reservation = await reserveIngestFlushWeight(
                  lane,
                  source.calendarId,
                  currentSource.ingestWindowRecordedAt !== null,
                  signal,
                );
                try {
                  const ingestionResult = await ingestSource({
                    calendarId: source.calendarId,
                    fetchEvents: () => fetcher.fetchEvents(),
                    isCurrent,
                    withPersistenceTransaction: createIngestionPersistenceTransaction(
                      source.calendarId,
                      signal,
                      deadlineAt,
                      reservation,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    reauthentication: {
                      accountId: currentSource.accountId,
                      demand: "authenticated" as const,
                    },
                    shouldPush: ingestionState.authorityChanged
                      || ingestionResult.eventsAdded > 0
                      || ingestionResult.eventsRemoved > 0,
                    userId: currentSource.userId,
                  };
                } finally {
                  reservation.release();
                  await rateLimiter?.dispose?.().catch((error: unknown) => {
                    widelog.errorFields(error, {
                      slug: "rate-limiter-dispose-failed",
                      retriable: true,
                    });
                  });
                }
              }, shouldApplyOAuthIngestBackoff),
            );
            if (!result) {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {

            widelog.set("outcome", "error");

            if (hasErrorFlag(error, "authRequired")) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              return createRejectedIngestionResult(source.userId, source.accountId, "request-rejected");
            }

            if (hasErrorFlag(error, "oauthReauthRequired")) {
              widelog.errorFields(error, { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true });

              return createRejectedIngestionResult(source.userId, source.accountId, "credential-rejected");
            }

            const missingCalendarFailure = resolveMissingCalendarFailure(error);
            if (missingCalendarFailure) {
              widelog.errorFields(error, missingCalendarFailure);
              throw error;
            }

            widelog.errorFields(error, {
              slug: resolveIngestErrorSlug(error),
              retriable: true,
            });
            throw error;
          } finally {
            widelog.flush();
          }
        }),
      SOURCE_TIMEOUT_MS);
    }),
oauthSources.map((source) => source.userId),
    { groupConcurrency: USER_GROUP_CONCURRENCY, taskConcurrency: USER_CALENDAR_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    lane,
    settlements,
    oauthSources.map(({ accountId, reauthenticationSource }) => ({
      accountId,
      recordedDemandSource: reauthenticationSource,
    })),
  );
};

const ingestCalDAVSources = async (lane: IngestLane): Promise<IngestionBatchResult> => {
  if (!env.ENCRYPTION_KEY) {
    return createEmptyIngestionBatchResult();
  }

  const encryptionKey = env.ENCRYPTION_KEY;

  const caldavSources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      calendarUrl: calendarsTable.calendarUrl,
      provider: calendarAccountsTable.provider,
      reauthenticationSource: calendarAccountsTable.reauthenticationSource,
      username: caldavCredentialsTable.username,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarsTable.userId,
      ingestFutureRange: calendarsTable.ingestFutureRange,
      ingestHistoricRange: calendarsTable.ingestHistoricRange,
      ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(caldavCredentialsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .leftJoin(userSubscriptionsTable, eq(calendarsTable.userId, userSubscriptionsTable.userId))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
      ),
    )
    .orderBy(
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
    );

  const settlements = await allSettledGroupedWithConcurrency(
    caldavSources.map((source) => {
      const enqueuedAt = Date.now();
      return () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", source.provider);
          widelog.set("provider.account_id", source.accountId);
          widelog.set("provider.calendar_id", source.calendarId);

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(lane, source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await measureDatabaseRead(lane, () => database
                  .select({
                    accountId: calendarAccountsTable.id,
                    calendarUrl: calendarsTable.calendarUrl,
                    encryptedPassword: caldavCredentialsTable.encryptedPassword,
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    provider: calendarAccountsTable.provider,
                    serverUrl: caldavCredentialsTable.serverUrl,
                    userId: calendarsTable.userId,
                    username: caldavCredentialsTable.username,
                  })
                  .from(calendarsTable)
                  .innerJoin(
                    calendarAccountsTable,
                    eq(calendarsTable.accountId, calendarAccountsTable.id),
                  )
                  .innerJoin(
                    caldavCredentialsTable,
                    eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
                  )
                  .where(and(
                    eq(calendarsTable.id, source.calendarId),
                    eq(calendarsTable.disabled, false),
                    arrayContains(calendarsTable.capabilities, ["pull"]),
                  ))
                  .limit(1));
                if (!currentSource) {
                  return createSkippedIngestionResult(source.userId);
                }
                const ranges = await getRequiredSourceRanges(lane, source.calendarId);
                const rateLimiter = resolveRateLimiter(currentSource.provider, {
                  accountId: currentSource.accountId,
                  serverUrl: currentSource.serverUrl,
                  userId: currentSource.userId,
                });
                const fetcher = createCalDAVSourceFetcher({
                  calendarDiscoveryCache: createCalendarDiscoveryCache(
                    refreshLockRedis,
                    currentSource.accountId,
                  ),
                  calendarUrl: currentSource.calendarUrl ?? currentSource.serverUrl,
                  onBeforeRequest: async () => {
                    await rateLimiter?.acquire(1, signal);
                  },
                  serverUrl: currentSource.serverUrl,
                  username: currentSource.username,
                  password: decryptPassword(currentSource.encryptedPassword, encryptionKey),
                  safeFetchOptions: { ...safeFetchOptions, signal },
                  plan: createSourceIngestionPlan(
                    ranges.historicRange,
                    ranges.futureRange,
                  ),
                });
                const reservation = await reserveIngestFlushWeight(
                  lane,
                  source.calendarId,
                  currentSource.ingestWindowRecordedAt !== null,
                  signal,
                );
                try {
                  const ingestionResult = await ingestSource({
                    calendarId: source.calendarId,
                    fetchEvents: async () => {
                      const fetchResult = await fetcher.fetchEvents();
                      recordSkippedResources(
                        fetchResult.skippedResourceCount ?? 0,
                        fetchResult.skippedResourceReasons ?? [],
                      );
                      return fetchResult;
                    },
                    isCurrent,
                    withPersistenceTransaction: createIngestionPersistenceTransaction(
                      source.calendarId,
                      signal,
                      deadlineAt,
                      reservation,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    reauthentication: {
                      accountId: source.accountId,
                      demand: "authenticated" as const,
                    },
                    shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                      || ingestionResult.eventsAdded > 0
                      || ingestionResult.eventsRemoved > 0,
                    userId: currentSource.userId,
                  };
                } finally {
                  reservation.release();
                }
              }, (error) =>
                !shouldTreatAsProviderAuthFailure(error)
                && !isIngestInfrastructureError(error)),
            );
            if (!result) {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {

            widelog.set("outcome", "error");

            if (shouldTreatAsProviderAuthFailure(error)) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              return createRejectedIngestionResult(source.userId, source.accountId, "request-rejected");
            }

            const missingCalendarFailure = resolveMissingCalendarFailure(error);
            if (missingCalendarFailure) {
              widelog.errorFields(error, missingCalendarFailure);
            } else {
              widelog.errorFields(error, {
                slug: resolveIngestErrorSlug(error),
                retriable: true,
              });
            }

            throw error;
          } finally {
            widelog.flush();
          }
        }),
      SOURCE_TIMEOUT_MS);
    }),
caldavSources.map((source) => source.userId),
    { groupConcurrency: USER_GROUP_CONCURRENCY, taskConcurrency: USER_CALENDAR_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    lane,
    settlements,
    caldavSources.map(({ accountId, reauthenticationSource }) => ({
      accountId,
      recordedDemandSource: reauthenticationSource,
    })),
  );
};

const ingestIcsSources = async (lane: IngestLane): Promise<IngestionBatchResult> => {
  const icsSources = await database
    .select({
      calendarId: calendarsTable.id,
      url: calendarsTable.url,
      treatFullDayTimedEventsAsAllDay: calendarsTable.treatFullDayTimedEventsAsAllDay,
      userId: calendarsTable.userId,
      ingestFutureRange: calendarsTable.ingestFutureRange,
      ingestHistoricRange: calendarsTable.ingestHistoricRange,
      ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
    })
    .from(calendarsTable)
    .leftJoin(userSubscriptionsTable, eq(calendarsTable.userId, userSubscriptionsTable.userId))
    .where(
      and(
        eq(calendarsTable.calendarType, "ical"),
        eq(calendarsTable.disabled, false),
      ),
    )
    .orderBy(
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
    );

  const settlements = await allSettledGroupedWithConcurrency(
    icsSources.map((source) => {
      const enqueuedAt = Date.now();
      return () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", "ical");
          widelog.set("provider.calendar_id", source.calendarId);

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(lane, source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await measureDatabaseRead(lane, () => database
                  .select({
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    treatFullDayTimedEventsAsAllDay:
                      calendarsTable.treatFullDayTimedEventsAsAllDay,
                    url: calendarsTable.url,
                    userId: calendarsTable.userId,
                  })
                  .from(calendarsTable)
                  .where(and(
                    eq(calendarsTable.id, source.calendarId),
                    eq(calendarsTable.calendarType, "ical"),
                    eq(calendarsTable.disabled, false),
                  ))
                  .limit(1));
                if (!currentSource?.url) {
                  return createSkippedIngestionResult(source.userId);
                }
                const ranges = await getRequiredSourceRanges(lane, source.calendarId);
                const rateLimiter = resolveRateLimiter("ical", {
                  url: currentSource.url,
                  userId: currentSource.userId,
                });
                const fetcher = createIcsSourceFetcher({
                  calendarId: source.calendarId,
                  url: currentSource.url,
                  database,
                  safeFetchOptions: { ...safeFetchOptions, signal },
                  plan: createSourceIngestionPlan(
                    ranges.historicRange,
                    ranges.futureRange,
                  ),
                });
                const reservation = await reserveIngestFlushWeight(
                  lane,
                  source.calendarId,
                  currentSource.ingestWindowRecordedAt !== null,
                  signal,
                );
                try {
                  const ingestionResult = await ingestSource({
                    calendarId: source.calendarId,
                    fetchEvents: async () => {
                      await rateLimiter?.acquire(1, signal);
                      return await fetcher.fetchEvents({
                        interpretEvents: (events, fetchContext) =>
                          interpretFullDayTimedEventsAsAllDay(events, {
                            calendarTimeZone: fetchContext.calendarTimeZone,
                            enabled: currentSource.treatFullDayTimedEventsAsAllDay,
                          }),
                      });
                    },
                    isCurrent,
                    withPersistenceTransaction: createIngestionPersistenceTransaction(
                      source.calendarId,
                      signal,
                      deadlineAt,
                      reservation,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    reauthentication: null,
                    shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                      || ingestionResult.eventsAdded > 0
                      || ingestionResult.eventsRemoved > 0,
                    userId: currentSource.userId,
                  };
                } finally {
                  reservation.release();
                }
              }, (error) => !isIngestInfrastructureError(error)),
            );
            if (!result) {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {

            widelog.set("outcome", "error");
            widelog.errorFields(error, {
              slug: resolveIngestErrorSlug(error),
              retriable: true,
            });
            throw error;
          } finally {
            widelog.flush();
          }
        }),
      SOURCE_TIMEOUT_MS);
    }),
icsSources.map((source) => source.userId),
    { groupConcurrency: ICS_PARSE_CONCURRENCY, taskConcurrency: ICS_CALENDAR_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    lane,
    settlements,
    icsSources.map(() => ({ accountId: null, recordedDemandSource: null })),
  );
};

/*
 * The enqueue filters a free user's destinations out unless a request is pending, so a
 * calendar's first ingest would otherwise wait out the 30 minute free cadence. Recording
 * the request rather than bypassing the filter also survives a failed enqueue: the row
 * stays and the next pass honours it.
 */
const recordFirstIngestSyncRequests = async (userIds: Set<string>): Promise<void> => {
  const settlements = await Promise.allSettled([...userIds].map((userId) => {
    const request = { requestId: crypto.randomUUID(), requestedAt: new Date() };
    return database
      .insert(userSyncRequestsTable)
      .values({ ...request, userId })
      .onConflictDoUpdate({ target: userSyncRequestsTable.userId, set: request });
  }));
  /*
   * Recording is a head start, so it must not cost the pass its enqueue: a throw here would
   * strand every established user in the batch to hurry one new calendar.
   */
  for (const settlement of settlements) {
    if (settlement.status === "rejected") {
      widelog.errorFields(settlement.reason, {
        retriable: true,
        slug: "first-ingest-sync-request-failed",
      });
    }
  }
};

export default withCronWideEvent({
  async callback() {
    const settlements = await Promise.allSettled([
      ingestOAuthSources(),
      ingestCalDAVSources(fleetIngestLane),
      ingestIcsSources(fleetIngestLane),
    ]);
    const failures: unknown[] = [];
    let failedSourceCount = 0;
    const affectedUserIds = new Set<string>();
    const firstIngestUserIds = new Set<string>();

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
        failures.push(settlement.reason);
        continue;
      }
      failedSourceCount += settlement.value.errors;
      for (const userId of settlement.value.affectedUserIds) {
        affectedUserIds.add(userId);
      }
      for (const userId of settlement.value.firstIngestUserIds) {
        firstIngestUserIds.add(userId);
      }
    }

    await recordFirstIngestSyncRequests(firstIngestUserIds);
    await enqueueDestinationSyncsForUsers(affectedUserIds);

    if (failedSourceCount > 0) {
      failures.push(new Error(`${failedSourceCount} calendar source ingestions failed`));
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Calendar source ingestion completed with failures");
    }
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: "ingest-sources",
  overrunProtection: false,
}) satisfies CronOptions;

export { ingestOAuthSources, resolveRateLimiter };
export type { IngestionBatchResult };
