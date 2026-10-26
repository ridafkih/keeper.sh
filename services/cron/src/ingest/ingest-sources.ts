import {
  ingestSource,
  allSettledGroupedWithConcurrency,
  insertEventStatesWithConflictResolution,
  buildEventStateInsertRow,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
  createGoogleUserRateLimiter,
  withGoogleProjectBudget,
  createRedisRateLimiter,
  createCalDAVAccountRateLimiter,
  createHostRateLimiter,
  createOutlookAccountSemaphore,
  createOutlookRequestLimiter,
  isCalDAVProvider,
  isHostedCalDAVProvider,
  getCalDAVAccountRequestsPerMinute,
  ensureValidToken,
  isTimeoutError,
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
import type { IngestOutcome, IngestWideEventFields, IngestionResult, IngestionFetchEventsResult, IngestionPersistenceWork, RedisLeaseClient, RedisRateLimiter, RequiredSourceRanges, TokenState } from "@keeper.sh/calendar";
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
import {
  decryptPassword,
  hasSiblingReadSinceLastSuccess,
  resolveDatabaseErrorClassification,
} from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import {
  INGEST_BASELINE_MOVED_SLUG,
  IngestBaselineMovedError,
  isIngestBaselineMovedError,
} from "@/utils/ingest-baseline";
import { withAbortTimeout } from "@/utils/with-abort-timeout";
import { createSyncLock } from "@keeper.sh/sync";
import { deleteEventStatesInChunks } from "@/utils/delete-event-states";
import { selectIngestWideEventFields } from "@/utils/ingest-wide-event";
import { estimateIngestWeight } from "@/utils/ingest-weight";
import { measureDatabaseRead, measureDatabaseWrite } from "@/utils/measured-database";
import { fleetIngestLane } from "@/utils/ingest-lanes";
import { resolveIngestDials } from "./ingest-dials";
import { withProviderRateLimit } from "./provider-rate-limit";
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

type SourceIngestRun<TResult> =
  | { result: TResult; status: "completed" }
  | { status: "lock-held" }
  | { status: "missing" };

const backoffDecisions = new WeakMap<object, boolean>();

const recordBackoffDecision = (error: unknown, backoff: boolean): void => {
  if (typeof error === "object" && error !== null) {
    backoffDecisions.set(error, backoff);
  }
};

const resolveBackoffDecision = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return backoffDecisions.get(error) ?? false;
};

const runSourceIngest = async <TSource, TResult>(
  calendarId: string,
  signal: AbortSignal,
  readSource: () => Promise<TSource | undefined>,
  work: (source: TSource, isCurrent: () => Promise<boolean>) => Promise<TResult>,
  shouldApplyBackoff: (error: unknown) => boolean,
): Promise<SourceIngestRun<TResult>> => {
  const lockResult = await measureSegment("wait.source_lock_ms", () => sourceIngestLock.acquire(
    `${SOURCE_INGEST_LOCK_KEY_PREFIX}${calendarId}`,
    signal,
  ));
  widelog.set("ingest.lock_acquired", lockResult.acquired);
  if (!lockResult.acquired) {
    signal.throwIfAborted();
    return { status: "lock-held" };
  }
  try {
    const source = await readSource();
    if (!source) {
      return { status: "missing" };
    }
    try {
      return { result: await work(source, lockResult.handle.isCurrent), status: "completed" };
    } catch (error) {
      recordBackoffDecision(error, shouldApplyBackoff(error) && !isIngestBaselineMovedError(error));
      throw error;
    }
  } finally {
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
  cachedStoredEventCount: number | null,
): Promise<IngestFlushReservation> => {
  const weight = await estimateIngestWeight(
    {
      countStoredEvents: async (targetCalendarId: string): Promise<number> => {
        const rows = await measureDatabaseRead(lane.pooledQueryGate,() => database
          .select({ count: count() })
          .from(eventStatesTable)
          .where(eq(eventStatesTable.calendarId, targetCalendarId)));
        return rows[0]?.count ?? 0;
      },
    },
    calendarId,
    hasEverIngested,
    cachedStoredEventCount,
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
  baselineIngestSeq: number,
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

    ledger.readCount += 1;
    const [baseline] = await measureLedgerRead(ledger, () => transaction
      .select({ ingestSeq: calendarsTable.ingestSeq })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId))
      .limit(1));
    const storedIngestSeq = baseline?.ingestSeq ?? null;
    signal.throwIfAborted();
    if (storedIngestSeq !== null && storedIngestSeq !== baselineIngestSeq) {
      throw new IngestBaselineMovedError(calendarId, baselineIngestSeq, storedIngestSeq);
    }

    let existingEventCount: number | null = null;
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
        existingEventCount = events.length;
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

        if (existingEventCount !== null) {
          const storedEventCount = Math.max(
            0,
            existingEventCount + changes.inserts.length - changes.deletes.length,
          );
          await setRemainingStatementTimeout();
          ledger.writeCount += 1;
          await measureLedgerWrite(ledger, () => transaction
            .update(calendarsTable)
            .set({ storedEventCount })
            .where(eq(calendarsTable.id, calendarId)));
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

        await setRemainingStatementTimeout();
        ledger.writeCount += 1;
        await measureLedgerWrite(ledger, () => transaction
          .update(calendarsTable)
          .set({ ingestSeq: sql`${calendarsTable.ingestSeq} + 1` })
          .where(eq(calendarsTable.id, calendarId)));
        signal.throwIfAborted();
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

const { outlookRequestsPerMinute } = resolveIngestDials(env);

const resolveOutlookLimiter = (): RedisRateLimiter | null => {
  if (outlookRequestsPerMinute === null) {
    return null;
  }
  return createRedisRateLimiter(refreshLockRedis, "ratelimit:provider:outlook:ingest", {
    requestsPerMinute: outlookRequestsPerMinute,
  });
};

const resolveRateLimiter = (
  provider: string,
  source: RateLimiterSourceContext,
): RedisRateLimiter | undefined => {
  if (provider === "google") {
    return withGoogleProjectBudget(
      refreshLockRedis,
      createGoogleUserRateLimiter(refreshLockRedis, source.userId, "ingest"),
      env.GOOGLE_PROJECT_REQUESTS_PER_MINUTE,
    );
  }

  if (provider === "outlook") {
    if (!source.accountId) {
      return;
    }
    return withProviderRateLimit(
      resolveOutlookLimiter(),
      createOutlookRequestLimiter(
        createOutlookAccountSemaphore(leaseLockRedis, source.accountId),
        source.accountId,
      ),
    );
  }

  if (isCalDAVProvider(provider)) {
    if (isHostedCalDAVProvider(provider) && source.accountId) {
      return createCalDAVAccountRateLimiter(
        refreshLockRedis,
        source.accountId,
        getCalDAVAccountRequestsPerMinute(provider),
      );
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
  const mappings = await measureDatabaseRead(lane.pooledQueryGate,() => database
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
  excludesTentative: boolean;
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
  outcome: IngestOutcome;
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
        const written = await measureDatabaseWrite(lane.pooledQueryGate,() => database
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

interface IngestedCalendarOutcome {
  calendarId: string;
  outcome: IngestOutcome;
}

interface IngestionBatchResult {
  abortedCalendarIds: string[];
  added: number;
  affectedUserIds: string[];
  errors: number;
  firstIngestUserIds: string[];
  outcomes: IngestedCalendarOutcome[];
  removed: number;
}

const createSkippedIngestionResult = (
  userId: string,
  outcome: IngestOutcome,
): IngestionSourceResult => ({
  eventsAdded: 0,
  eventsRemoved: 0,
  firstIngest: false,
  outcome,
  reauthentication: null,
  shouldPush: false,
  userId,
});

const resolveSkippedOutcome = (run: { status: "lock-held" | "missing" }): IngestOutcome => {
  if (run.status === "lock-held") {
    return { kind: "lock-held" };
  }
  return { kind: "unresolvable" };
};

const recordBaselineMovedAbort = (error: unknown): boolean => {
  if (!isIngestBaselineMovedError(error)) {
    return false;
  }
  widelog.set("outcome", "aborted");
  widelog.set("ingest.baseline_moved", true);
  widelog.set("ingest.baseline_seq", error.expectedIngestSeq);
  widelog.set("ingest.observed_seq", error.observedIngestSeq);
  widelog.errorFields(error, { retriable: true, slug: INGEST_BASELINE_MOVED_SLUG });
  return true;
};

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
  ...createSkippedIngestionResult(userId, { kind: demand }),
  reauthentication: { accountId, demand },
});

const isSiblingStillReading = async (lane: IngestLane, calendarId: string): Promise<boolean> => {
  try {
    return await measureDatabaseRead(
      lane.pooledQueryGate,
      () => hasSiblingReadSinceLastSuccess(database, calendarId),
    );
  } catch {
    widelog.set("reauth.sibling_check_failed", true);
    return false;
  }
};

const createRequestRejectedIngestionResult = async (
  lane: IngestLane,
  source: { accountId: string; calendarId: string; userId: string },
): Promise<IngestionSourceResult> => {
  if (!await isSiblingStillReading(lane, source.calendarId)) {
    return createRejectedIngestionResult(source.userId, source.accountId, "request-rejected");
  }
  widelog.set("reauth.sibling_reading", true);
  return {
    ...createSkippedIngestionResult(source.userId, { kind: "request-rejected" }),
    reauthentication: { accountId: source.accountId, demand: "abstain" },
  };
};

const resolveRejectedOutcome = (reason: unknown): IngestOutcome => {
  if (isIngestBaselineMovedError(reason)) {
    return { kind: "baseline-moved" };
  }
  return { backoff: resolveBackoffDecision(reason), kind: "failed" };
};

const collectOutcomes = (
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  calendarIds: string[],
): IngestedCalendarOutcome[] =>
  settlements.flatMap((settlement, index): IngestedCalendarOutcome[] => {
    const calendarId = calendarIds[index];
    if (!calendarId) {
      return [];
    }
    if (settlement.status === "fulfilled") {
      return [{ calendarId, outcome: settlement.value.outcome }];
    }
    return [{ calendarId, outcome: resolveRejectedOutcome(settlement.reason) }];
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

const collectAbortedCalendarIds = (
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  calendarIds: string[],
): string[] =>
  settlements.flatMap((settlement, index): string[] => {
    if (settlement.status !== "rejected" || !isIngestBaselineMovedError(settlement.reason)) {
      return [];
    }
    const calendarId = calendarIds[index];
    if (!calendarId) {
      return [];
    }
    return [calendarId];
  });

const summariseIngestionSettlements = async (
  lane: IngestLane,
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  accounts: SourceAccountContext[],
  calendarIds: string[],
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
    abortedCalendarIds: collectAbortedCalendarIds(settlements, calendarIds),
    added: results.reduce((total, { eventsAdded }) => total + eventsAdded, 0),
    affectedUserIds: [
      ...new Set(results.filter(({ shouldPush }) => shouldPush).map(({ userId }) => userId)),
    ],
    errors: settlements.length - results.length,
    firstIngestUserIds: [
      ...new Set(results.filter(({ firstIngest }) => firstIngest).map(({ userId }) => userId)),
    ],
    outcomes: collectOutcomes(settlements, calendarIds),
    removed: results.reduce((total, { eventsRemoved }) => total + eventsRemoved, 0),
  };
};

const createEmptyIngestionBatchResult = (): IngestionBatchResult => ({
  abortedCalendarIds: [],
  added: 0,
  affectedUserIds: [],
  errors: 0,
  firstIngestUserIds: [],
  outcomes: [],
  removed: 0,
});

type IngestTrigger = "cron" | "push";

interface IngestClaimTelemetry {
  lagMs: number;
  lane: string;
  woken: boolean;
}

interface IngestRunOptions {
  claimByCalendarId?: Record<string, IngestClaimTelemetry>;
  correlationIdByCalendarId?: Record<string, string>;
  lane?: IngestLane;
  trigger?: IngestTrigger;
}

const resolveCalendarTrigger = (options: IngestRunOptions, calendarId: string): IngestTrigger => {
  if (options.claimByCalendarId?.[calendarId]?.woken) {
    return "push";
  }
  return options.trigger ?? "cron";
};

const recordClaimTelemetry = (options: IngestRunOptions, calendarId: string): void => {
  widelog.set("ingest.trigger", resolveCalendarTrigger(options, calendarId));
  const inboundCorrelationId = options.correlationIdByCalendarId?.[calendarId] ?? "";
  if (inboundCorrelationId.length > 0) {
    widelog.set("correlation.id", inboundCorrelationId);
  }
  const claim = options.claimByCalendarId?.[calendarId];
  if (claim) {
    widelog.set("schedule.lane", claim.lane);
    widelog.set("schedule.lag_ms", claim.lagMs);
  }
};

const buildOAuthSourceQuery = (calendarIds: string[]) =>
  database
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
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, calendarIds),
      ),
    )
    .orderBy(asc(calendarsTable.id));

const ingestOAuthSources = async (
  calendarIds: string[],
  options: IngestRunOptions = {},
): Promise<IngestionBatchResult> => {
  if (calendarIds.length === 0) {
    return createEmptyIngestionBatchResult();
  }
  const lane = options.lane ?? fleetIngestLane;

  const selectedSources = await buildOAuthSourceQuery(calendarIds);

  const settlements = await allSettledGroupedWithConcurrency(
    selectedSources.map((source) => {
      const enqueuedAt = Date.now();
      return (): Promise<IngestionSourceResult> =>
        withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          recordClaimTelemetry(options, source.calendarId);
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
            const run = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async () => {
                const [currentSource] = await measureDatabaseRead(lane.pooledQueryGate, () => database
                  .select({
                    accountId: calendarAccountsTable.id,
                    accessToken: oauthCredentialsTable.accessToken,
                    excludeAvailabilities: calendarsTable.excludeAvailabilities,
                    expiresAt: oauthCredentialsTable.expiresAt,
                    externalCalendarId: calendarsTable.externalCalendarId,
                    failureCount: calendarsTable.ingestFailureCount,
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestSeq: calendarsTable.ingestSeq,
                    ingestWindowEnd: calendarsTable.ingestWindowEnd,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    ingestWindowStart: calendarsTable.ingestWindowStart,
                    nextAttemptAt: calendarsTable.ingestNextAttemptAt,
                    oauthCredentialId: oauthCredentialsTable.id,
                    provider: calendarAccountsTable.provider,
                    refreshToken: oauthCredentialsTable.refreshToken,
                    storedEventCount: calendarsTable.storedEventCount,
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
                return currentSource;
              }, async (currentSource, isCurrent) => {
                if (!currentSource.externalCalendarId) {
                  return createSkippedIngestionResult(source.userId, { kind: "unresolvable" });
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
                  excludesTentative: currentSource.excludeAvailabilities.includes("tentative"),
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
                  return createSkippedIngestionResult(currentSource.userId, { kind: "unresolvable" });
                }
                const reservation = await reserveIngestFlushWeight(
                  lane,
                  source.calendarId,
                  currentSource.ingestWindowRecordedAt !== null,
                  signal,
                  currentSource.storedEventCount,
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
                      currentSource.ingestSeq,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    outcome: { kind: "ingested" } as const,
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
                }
              }, shouldApplyOAuthIngestBackoff),
            );
            if (run.status !== "completed") {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId, resolveSkippedOutcome(run));
            }
            const { result } = run;
            if (result.outcome.kind !== "ingested") {
              widelog.set("outcome", "skipped");
              return result;
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {
            if (recordBaselineMovedAbort(error)) {
              throw error;
            }

            widelog.set("outcome", "error");

            if (hasErrorFlag(error, "authRequired")) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              return await createRequestRejectedIngestionResult(lane, source);
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
selectedSources.map((source) => source.userId),
    { groupConcurrency: USER_GROUP_CONCURRENCY, taskConcurrency: USER_CALENDAR_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    lane,
    settlements,
    selectedSources.map(({ accountId, reauthenticationSource }) => ({
      accountId,
      recordedDemandSource: reauthenticationSource,
    })),
    selectedSources.map(({ calendarId }) => calendarId),
  );
};

const ingestCalDAVSources = async (
  calendarIds: string[],
  options: IngestRunOptions = {},
): Promise<IngestionBatchResult> => {
  if (!env.ENCRYPTION_KEY || calendarIds.length === 0) {
    return createEmptyIngestionBatchResult();
  }
  const lane = options.lane ?? fleetIngestLane;

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
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, calendarIds),
      ),
    )
    .orderBy(asc(calendarsTable.id));

  const settlements = await allSettledGroupedWithConcurrency(
    caldavSources.map((source) => {
      const enqueuedAt = Date.now();
      return () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          recordClaimTelemetry(options, source.calendarId);
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", source.provider);
          widelog.set("provider.account_id", source.accountId);
          widelog.set("provider.calendar_id", source.calendarId);

          try {
            const run = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async () => {
                const [currentSource] = await measureDatabaseRead(lane.pooledQueryGate, () => database
                  .select({
                    accountId: calendarAccountsTable.id,
                    calendarUrl: calendarsTable.calendarUrl,
                    encryptedPassword: caldavCredentialsTable.encryptedPassword,
                    failureCount: calendarsTable.ingestFailureCount,
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestSeq: calendarsTable.ingestSeq,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    nextAttemptAt: calendarsTable.ingestNextAttemptAt,
                    provider: calendarAccountsTable.provider,
                    serverUrl: caldavCredentialsTable.serverUrl,
                    storedEventCount: calendarsTable.storedEventCount,
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
                return currentSource;
              }, async (currentSource, isCurrent) => {
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
                  currentSource.storedEventCount,
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
                      currentSource.ingestSeq,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    outcome: { kind: "ingested" } as const,
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
            if (run.status !== "completed") {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId, resolveSkippedOutcome(run));
            }
            const { result } = run;
            if (result.outcome.kind !== "ingested") {
              widelog.set("outcome", "skipped");
              return result;
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {
            if (recordBaselineMovedAbort(error)) {
              throw error;
            }

            widelog.set("outcome", "error");

            if (shouldTreatAsProviderAuthFailure(error)) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              return await createRequestRejectedIngestionResult(lane, source);
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
    caldavSources.map(({ calendarId }) => calendarId),
  );
};

const ingestIcsSources = async (
  calendarIds: string[],
  options: IngestRunOptions = {},
): Promise<IngestionBatchResult> => {
  if (calendarIds.length === 0) {
    return createEmptyIngestionBatchResult();
  }
  const lane = options.lane ?? fleetIngestLane;
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
    .where(
      and(
        eq(calendarsTable.calendarType, "ical"),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, calendarIds),
      ),
    )
    .orderBy(asc(calendarsTable.id));

  const settlements = await allSettledGroupedWithConcurrency(
    icsSources.map((source) => {
      const enqueuedAt = Date.now();
      return () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("concurrency.slot_wait_ms", Date.now() - enqueuedAt);
          recordClaimTelemetry(options, source.calendarId);
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", "ical");
          widelog.set("provider.calendar_id", source.calendarId);

          try {
            const run = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async () => {
                const [currentSource] = await measureDatabaseRead(lane.pooledQueryGate, () => database
                  .select({
                    failureCount: calendarsTable.ingestFailureCount,
                    ingestFutureRange: calendarsTable.ingestFutureRange,
                    ingestHistoricRange: calendarsTable.ingestHistoricRange,
                    ingestSeq: calendarsTable.ingestSeq,
                    ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
                    nextAttemptAt: calendarsTable.ingestNextAttemptAt,
                    storedEventCount: calendarsTable.storedEventCount,
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
                return currentSource;
              }, async (currentSource, isCurrent) => {
                if (!currentSource.url) {
                  return createSkippedIngestionResult(source.userId, { kind: "unresolvable" });
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
                  currentSource.storedEventCount,
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
                      currentSource.ingestSeq,
                    ),
                    onIngestEvent: recordIngestWideEvent,
                  });
                  return {
                    eventsAdded: ingestionResult.eventsAdded,
                    eventsRemoved: ingestionResult.eventsRemoved,
                    firstIngest: currentSource.ingestWindowRecordedAt === null,
                    outcome: { kind: "ingested" } as const,
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
            if (run.status !== "completed") {
              widelog.set("outcome", "skipped");
              return createSkippedIngestionResult(source.userId, resolveSkippedOutcome(run));
            }
            const { result } = run;
            if (result.outcome.kind !== "ingested") {
              widelog.set("outcome", "skipped");
              return result;
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return result;
          } catch (error) {
            if (recordBaselineMovedAbort(error)) {
              throw error;
            }

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
    icsSources.map(({ calendarId }) => calendarId),
  );
};

const mergeIngestionBatchResults = (results: IngestionBatchResult[]): IngestionBatchResult => ({
  abortedCalendarIds: results.flatMap(({ abortedCalendarIds }) => abortedCalendarIds),
  added: results.reduce((total, { added }) => total + added, 0),
  affectedUserIds: [...new Set(results.flatMap(({ affectedUserIds }) => affectedUserIds))],
  errors: results.reduce((total, { errors }) => total + errors, 0),
  firstIngestUserIds: [...new Set(results.flatMap(({ firstIngestUserIds }) => firstIngestUserIds))],
  outcomes: results.flatMap(({ outcomes }) => outcomes),
  removed: results.reduce((total, { removed }) => total + removed, 0),
});

interface SourceCalendarsIngestion {
  failures: unknown[];
  result: IngestionBatchResult;
}

const ingestSourceCalendars = async (
  calendarIds: string[],
  options: IngestRunOptions = {},
): Promise<SourceCalendarsIngestion> => {
  const settlements = await Promise.allSettled([
    ingestOAuthSources(calendarIds, options),
    ingestCalDAVSources(calendarIds, options),
    ingestIcsSources(calendarIds, options),
  ]);
  const failures: unknown[] = [];
  const results: IngestionBatchResult[] = [];
  for (const settlement of settlements) {
    if (settlement.status === "rejected") {
      failures.push(settlement.reason);
      continue;
    }
    results.push(settlement.value);
  }
  return { failures, result: mergeIngestionBatchResults(results) };
};

export {
  ingestCalDAVSources,
  ingestIcsSources,
  ingestOAuthSources,
  ingestSourceCalendars,
  resolveRateLimiter,
};
export type {
  IngestClaimTelemetry,
  IngestRunOptions,
  IngestTrigger,
  IngestedCalendarOutcome,
  IngestionBatchResult,
  SourceCalendarsIngestion,
};
