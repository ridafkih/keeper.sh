import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
  buildEventStateInsertRow,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
  createGoogleUserRateLimiter,
  ensureValidToken,
  isTimeoutError,
  isOAuthReauthRequiredError,
  isOAuthRefreshInProgressError,
  isOAuthRefreshLockUnavailableError,
  buildCalendarBackoffState,
  buildReauthenticationDemandFields,
  readPriorReauthenticationState,
  resolveReauthenticationDemandAction,
  SOURCE_INGEST_LOCK_NAMESPACE,
  createRequiredSourceRanges,
  createSourceIngestionPlan,
} from "@keeper.sh/calendar";
import {
  INGEST_SOURCE_TIMEOUT_MS,
  INGEST_UNADJUDICABLE_REAUTHENTICATION_SOURCES,
  PROVIDER_INGEST_REQUEST_TIMEOUT_MS,
  REAUTHENTICATION_SOURCE_INGEST,
} from "@keeper.sh/constants";
import type { CalendarBackoffState, IngestWideEventFields, IngestionFetchEventsResult, IngestionPersistenceWork, RedisRateLimiter, RequiredSourceRanges, TokenState } from "@keeper.sh/calendar";
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
} from "@keeper.sh/calendar/caldav";
import { decryptPassword, resolveDatabaseErrorClassification } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { database, refreshLockRedis, refreshLockStore } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import {
  resolveMissingCalendarFailure,
  shouldTreatAsProviderAuthFailure,
} from "@/utils/provider-ingest-failure";
import {
  isOAuthRefreshContentionStalled,
  runSourceIngest as runSourceIngestWithDependencies,
} from "@/utils/run-source-ingest";
import type {
  SourceIngestAttempt,
  SourceIngestDependencies,
  SourceIngestHandlers,
} from "@/utils/run-source-ingest";
import { hasErrorFlag } from "@/utils/error-flags";
import { resolveOAuthIngestionState } from "@/utils/oauth-ingestion-state";
import {
  caldavCredentialIsUnchanged,
  oauthCredentialIsUnchanged,
} from "@/utils/reauthentication-guard";
import { withAbortTimeout } from "@/utils/with-abort-timeout";
import { createSyncLock } from "@keeper.sh/sync";
import { enqueueDestinationSyncsForUsers } from "@/utils/enqueue-destination-syncs";
import { deleteEventStatesInChunks } from "@/utils/delete-event-states";
import { selectIngestWideEventFields } from "@/utils/ingest-wide-event";

const SOURCE_TIMEOUT_MS = INGEST_SOURCE_TIMEOUT_MS;
const SOURCE_TIMEOUT_DATABASE_GRACE_MS = 5000;
const SOURCE_CONCURRENCY = 5;
const SOURCE_INGEST_LOCK_KEY_PREFIX = "source-ingest:";
const sourceIngestLock = createSyncLock(refreshLockRedis);

const matchesObservedAttemptClock = (nextAttemptAt: Date | null) => {
  if (nextAttemptAt === null) {
    return isNull(calendarsTable.ingestNextAttemptAt);
  }
  return eq(calendarsTable.ingestNextAttemptAt, nextAttemptAt);
};

const resetIngestBackoff = async (
  calendarId: string,
  observedAttempt: SourceIngestAttempt,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    })
    .where(and(
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.ingestFailureCount, observedAttempt.failureCount),
      matchesObservedAttemptClock(observedAttempt.nextAttemptAt),
    ));
};

const applyIngestBackoff = async (
  calendarId: string,
  observedAttempt: SourceIngestAttempt,
): Promise<CalendarBackoffState | null> => {
  const state = buildCalendarBackoffState(observedAttempt.failureCount);
  const updated = await database
    .update(calendarsTable)
    .set({
      ingestFailureCount: state.failureCount,
      ingestLastFailureAt: state.lastFailureAt,
      ingestNextAttemptAt: state.nextAttemptAt,
    })
    .where(and(
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.ingestFailureCount, observedAttempt.failureCount),
      matchesObservedAttemptClock(observedAttempt.nextAttemptAt),
    ))
    .returning({ id: calendarsTable.id });
  if (updated.length === 0) {
    return null;
  }
  return state;
};

const logIngestBackoff = (state: CalendarBackoffState): void => {
  widelog.set("retry.failure_count", state.failureCount);
  if (state.nextAttemptAt) {
    widelog.set("retry.next_attempt_at", state.nextAttemptAt.toISOString());
  }
};

const sourceIngestDependencies: SourceIngestDependencies = {
  acquireLease: async (calendarId, signal) => {
    const lockResult = await sourceIngestLock.acquire(
      `${SOURCE_INGEST_LOCK_KEY_PREFIX}${calendarId}`,
      signal,
    );
    if (!lockResult.acquired) {
      return null;
    }
    return {
      isCurrent: lockResult.handle.isCurrent,
      release: lockResult.handle.release,
    };
  },
  applyBackoff: applyIngestBackoff,
  readAttempt: async (calendarId) => {
    const [attempt] = await database
      .select({
        failureCount: calendarsTable.ingestFailureCount,
        nextAttemptAt: calendarsTable.ingestNextAttemptAt,
      })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId))
      .limit(1);
    return attempt ?? null;
  },
  recordBackoff: logIngestBackoff,
  resetBackoff: resetIngestBackoff,
};

const runSourceIngest = <TResult>(
  calendarId: string,
  signal: AbortSignal,
  work: (isCurrent: () => Promise<boolean>) => Promise<TResult>,
  handlers: SourceIngestHandlers = {},
): Promise<TResult | null> =>
  runSourceIngestWithDependencies(
    sourceIngestDependencies,
    calendarId,
    signal,
    work,
    handlers,
  );

interface ObservedOAuthCredential {
  oauthCredentialId: string;
  tokenState: TokenState;
}

interface ObservedCalDAVCredential {
  caldavCredentialId: string;
  encryptedPassword: string;
}

const observedCredentialGuard = (
  credential: ObservedOAuthCredential | null,
): SQL | undefined => {
  if (!credential) {
    return;
  }
  return oauthCredentialIsUnchanged({
    oauthCredentialId: credential.oauthCredentialId,
    refreshToken: credential.tokenState.refreshToken,
  });
};

const observedCalDAVCredentialGuard = (
  credential: ObservedCalDAVCredential | null,
): SQL | undefined => {
  if (!credential) {
    return;
  }
  return caldavCredentialIsUnchanged(credential);
};

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

const createIngestionPersistenceTransaction = (
  calendarId: string,
  signal: AbortSignal,
  deadlineAt: number,
) =>
  (work: IngestionPersistenceWork) => database.transaction(async (transaction) => {
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
    await setRemainingStatementTimeout();
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${SOURCE_INGEST_LOCK_NAMESPACE}, hashtext(${calendarId}))`,
    );
    signal.throwIfAborted();

    const result = await work({
      readExistingEvents: async () => {
        await setRemainingStatementTimeout();
        const events = await transaction.select({
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
          .where(eq(eventStatesTable.calendarId, calendarId));
        signal.throwIfAborted();
        return events;
      },
      flush: async (changes) => {
        signal.throwIfAborted();
        if (changes.deletes.length > 0) {
          await setRemainingStatementTimeout();
          await deleteEventStatesInChunks(transaction, calendarId, changes.deletes);
          signal.throwIfAborted();
        }

        if (changes.inserts.length > 0) {
          await setRemainingStatementTimeout();
          await insertEventStatesWithConflictResolution(
            transaction,
            changes.inserts.map((event) => buildEventStateInsertRow(calendarId, event)),
          );
          signal.throwIfAborted();
        }

        if ("syncToken" in changes) {
          await setRemainingStatementTimeout();
          await transaction
            .update(calendarsTable)
            .set({ syncToken: changes.syncToken })
            .where(eq(calendarsTable.id, calendarId));
          signal.throwIfAborted();
        }

        if (changes.coverage) {
          const { futureRange, historicRange, window } = changes.coverage;
          await setRemainingStatementTimeout();
          /*
           * Snapshot sources report coverage on every run. The window is anchored to
           * the start of the day, so rewriting it unconditionally would churn this row
           * (and its updatedAt) once per tick rather than once per day.
           */
          await transaction
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
            ));
          signal.throwIfAborted();
        }

        if (changes.snapshot) {
          await setRemainingStatementTimeout();
          await persistCalendarSnapshot(transaction, calendarId, changes.snapshot);
          signal.throwIfAborted();
        }
      },
    });
    signal.throwIfAborted();
    return result;
  });

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

const resolveRateLimiter = (provider: string, userId: string): RedisRateLimiter | undefined => {
  if (provider !== "google") {
    return;
  }

  return createGoogleUserRateLimiter(refreshLockRedis, userId, "ingest");
};

const getRequiredSourceRanges = async (
  sourceCalendarId: string,
): Promise<RequiredSourceRanges> => {
  const mappings = await database
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
    ));
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
  credentialIsUnchanged?: SQL;
  demand: ReauthenticationDemand;
}

interface ReauthenticationVerdict {
  credentialIsUnchanged: SQL | null;
  needsReauthentication: boolean;
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
  reauthentication: ReauthenticationDemandRecord | null;
  shouldPush: boolean;
  userId: string;
}

const resolveReauthenticationDemands = (
  demands: ReauthenticationDemandRecord[],
): Map<string, ReauthenticationVerdict> => {
  const castByAccount = new Map(
    [...new Set(demands.map(({ accountId }) => accountId))].map((
      accountId,
    ): [string, ReauthenticationDemandRecord[]] => [
      accountId,
      demands.filter((record) => record.accountId === accountId),
    ]),
  );
  return new Map(
    [...castByAccount].flatMap(([accountId, cast]): [string, ReauthenticationVerdict][] => {
      const decisive = REAUTHENTICATION_DEMAND_PRECEDENCE.find((demand) =>
        cast.some((record) => record.demand === demand));
      if (!decisive) {
        return [];
      }
      const decisiveRecord = cast.find((record) => record.demand === decisive);
      return [[accountId, {
        credentialIsUnchanged: decisiveRecord?.credentialIsUnchanged ?? null,
        needsReauthentication: decisive !== "authenticated",
      }]];
    }),
  );
};

/**
 * A demand is only worth raising against the credential the rejected run was
 * judged on. A reconnect that landed while the batch was in flight replaces
 * that credential, and the demand it would raise is already stale.
 */
const resolveDemandGuard = (verdict: ReauthenticationVerdict): SQL | null => {
  if (!verdict.needsReauthentication) {
    return null;
  }
  return verdict.credentialIsUnchanged;
};

const buildDemandPredicate = (
  accountId: string,
  verdict: ReauthenticationVerdict,
): SQL | undefined => {
  const guard = resolveDemandGuard(verdict);
  if (!guard) {
    return and(
      eq(calendarAccountsTable.id, accountId),
      ne(calendarAccountsTable.needsReauthentication, verdict.needsReauthentication),
    );
  }
  return and(
    eq(calendarAccountsTable.id, accountId),
    guard,
    ne(calendarAccountsTable.needsReauthentication, verdict.needsReauthentication),
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

/**
 * A raise that wrote nothing is ambiguous: the flag may already be standing,
 * or the credential the verdict was judged on may have been replaced by a
 * reconnect mid-batch. Only the live flag distinguishes the two; when it
 * cannot be read the raise is reported as a re-raise rather than guessed
 * to be suppressed.
 */
const demandGuardRejectedWrite = async (
  accountId: string,
  verdict: ReauthenticationVerdict,
): Promise<boolean> => {
  if (!resolveDemandGuard(verdict)) {
    return false;
  }
  const prior = await readPriorReauthenticationState(database, accountId);
  return prior?.needsReauthentication === false;
};

const applyReauthenticationDemands = async (
  demands: ReauthenticationDemandRecord[],
  recordedDemandSources: Map<string, string | null>,
): Promise<void> => {
  for (const [accountId, verdict] of resolveReauthenticationDemands(demands)) {
    const { needsReauthentication } = verdict;
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
        const written = await database
          .update(calendarAccountsTable)
          .set({
            needsReauthentication,
            reauthenticationSource: resolveRecordedDemandSource(needsReauthentication),
          })
          .where(buildDemandPredicate(accountId, verdict))
          .returning({ id: calendarAccountsTable.id });
        const transitioned = written.length > 0;
        if (!transitioned && await demandGuardRejectedWrite(accountId, verdict)) {
          recordReauthenticationDemandFields(buildReauthenticationDemandFields({
            accountId,
            action: "raise",
            previous: null,
            provenance: REAUTHENTICATION_SOURCE_INGEST,
            recordedProvenance: recordedDemandSource,
            signal: resolveRaiseSignal(needsReauthentication, decidingVote),
          }));
          widelog.set("reauth.suppressed", true);
          widelog.set("outcome", "skipped");
          return;
        }
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
  removed: number;
}

const createSkippedIngestionResult = (userId: string): IngestionSourceResult => ({
  eventsAdded: 0,
  eventsRemoved: 0,
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
  credentialIsUnchanged?: SQL,
): IngestionSourceResult => ({
  ...createSkippedIngestionResult(userId),
  reauthentication: {
    accountId,
    demand,
    ...(credentialIsUnchanged && { credentialIsUnchanged }),
  },
});

/**
 * A run that lost its attempt mid-flight — a reconnect landed, or another
 * replica settled the calendar — no longer speaks for the credential it was
 * judged on, so it abstains instead of voting to raise a demand the reconnect
 * has already answered.
 */
const createAuthenticationRejection = (
  options: {
    accountId: string;
    credentialIsUnchanged: SQL | undefined;
    demand: AuthenticationRejection;
    isCurrent: boolean;
    userId: string;
  },
): IngestionSourceResult => {
  if (!options.isCurrent) {
    widelog.set("failure.reauth_vote_skipped", "attempt-state-changed");
    return createSkippedIngestionResult(options.userId);
  }
  return createRejectedIngestionResult(
    options.userId,
    options.accountId,
    options.demand,
    options.credentialIsUnchanged,
  );
};

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
  settlements: PromiseSettledResult<IngestionSourceResult>[],
  accounts: SourceAccountContext[],
): Promise<IngestionBatchResult> => {
  const results = settlements
    .filter((settlement): settlement is PromiseFulfilledResult<IngestionSourceResult> =>
      settlement.status === "fulfilled")
    .map(({ value }) => value);

  await applyReauthenticationDemands(
    collectReauthenticationDemands(settlements, accounts),
    collectRecordedDemandSources(accounts),
  );

  return {
    added: results.reduce((total, { eventsAdded }) => total + eventsAdded, 0),
    affectedUserIds: [
      ...new Set(results.filter(({ shouldPush }) => shouldPush).map(({ userId }) => userId)),
    ],
    errors: settlements.length - results.length,
    removed: results.reduce((total, { eventsRemoved }) => total + eventsRemoved, 0),
  };
};

const ingestOAuthSources = async (): Promise<IngestionBatchResult> => {
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
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
      ),
    );

  const settlements = await allSettledWithConcurrency(
    oauthSources.map((source) => () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
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

          let observedCredential: ObservedOAuthCredential | null = null;
          let rejectionIsCurrent = false;

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await database
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
                  .limit(1);
                if (!currentSource?.externalCalendarId) {
                  return createSkippedIngestionResult(source.userId);
                }

                const rawRefresher = resolveTokenRefresher(currentSource.provider);
                const tokenState: TokenState = {
                  accessToken: currentSource.accessToken,
                  accessTokenExpiresAt: currentSource.expiresAt,
                  refreshToken: currentSource.refreshToken,
                };
                observedCredential = {
                  oauthCredentialId: currentSource.oauthCredentialId,
                  tokenState,
                };
                if (rawRefresher) {
                  const tokenRefresher = createCoordinatedRefresher({
                    database,
                    oauthCredentialId: currentSource.oauthCredentialId,
                    calendarAccountId: currentSource.accountId,
                    onBookkeepingError: (scope, bookkeepingError) => {
                      widelog.error(scope, bookkeepingError);
                    },
                    refreshLockStore,
                    rawRefresh: rawRefresher,
                  });
                  await ensureValidToken(tokenState, tokenRefresher);
                }

                const ranges = await getRequiredSourceRanges(source.calendarId);
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
                const fetcher = resolveOAuthFetcher(currentSource.provider, {
                  accessToken: tokenState.accessToken,
                  calendarId: source.calendarId,
                  externalCalendarId: currentSource.externalCalendarId,
                  syncToken: ingestionState.syncToken,
                  rateLimiter: resolveRateLimiter(currentSource.provider, currentSource.userId),
                  signal,
                  plan: createSourceIngestionPlan(
                    ranges.historicRange,
                    ranges.futureRange,
                  ),
                });
                if (!fetcher) {
                  return createSkippedIngestionResult(currentSource.userId);
                }
                const ingestionResult = await ingestSource({
                  calendarId: source.calendarId,
                  fetchEvents: () => fetcher.fetchEvents(),
                  isCurrent,
                  withPersistenceTransaction:
                    createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                  onIngestEvent: recordIngestWideEvent,
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  reauthentication: {
                    accountId: currentSource.accountId,
                    demand: "authenticated" as const,
                  },
                  shouldPush: ingestionState.authorityChanged
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
              }, {
                onSettledFailure: () => {
                  rejectionIsCurrent = true;
                },
              }),
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
            if (
              isOAuthRefreshInProgressError(error)
              && !isOAuthRefreshContentionStalled(source.calendarId)
            ) {
              widelog.set("outcome", "skipped");
              widelog.set("skip.reason", "oauth-refresh-in-progress");

              return createSkippedIngestionResult(source.userId);
            }

            widelog.set("outcome", "error");

            if (isOAuthRefreshLockUnavailableError(error)) {
              widelog.errorFields(error, {
                slug: "oauth-refresh-lock-unavailable",
                retriable: true,
              });
              throw error;
            }

            if (isOAuthRefreshInProgressError(error)) {
              widelog.errorFields(error, {
                slug: "oauth-refresh-contention-stalled",
                retriable: true,
              });
              throw error;
            }

            if (hasErrorFlag(error, "authRequired")) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              return createAuthenticationRejection({
                accountId: source.accountId,
                credentialIsUnchanged: observedCredentialGuard(observedCredential),
                demand: "request-rejected",
                isCurrent: rejectionIsCurrent,
                userId: source.userId,
              });
            }

            if (isOAuthReauthRequiredError(error)) {
              widelog.errorFields(error, { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true });

              return createAuthenticationRejection({
                accountId: source.accountId,
                credentialIsUnchanged: observedCredentialGuard(observedCredential),
                demand: "credential-rejected",
                isCurrent: rejectionIsCurrent,
                userId: source.userId,
              });
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
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    settlements,
    oauthSources.map(({ accountId, reauthenticationSource }) => ({
      accountId,
      recordedDemandSource: reauthenticationSource,
    })),
  );
};

const ingestCalDAVSources = async (): Promise<IngestionBatchResult> => {
  if (!env.ENCRYPTION_KEY) {
    return { added: 0, affectedUserIds: [], removed: 0, errors: 0 };
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
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
      ),
    );

  const settlements = await allSettledWithConcurrency(
    caldavSources.map((source) => () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", source.provider);
          widelog.set("provider.account_id", source.accountId);
          widelog.set("provider.calendar_id", source.calendarId);

          let observedCredential: ObservedCalDAVCredential | null = null;
          let rejectionIsCurrent = false;

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await database
                  .select({
                    caldavCredentialId: caldavCredentialsTable.id,
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
                  .limit(1);
                if (!currentSource) {
                  return createSkippedIngestionResult(source.userId);
                }
                observedCredential = {
                  caldavCredentialId: currentSource.caldavCredentialId,
                  encryptedPassword: currentSource.encryptedPassword,
                };
                const ranges = await getRequiredSourceRanges(source.calendarId);
                const fetcher = createCalDAVSourceFetcher({
                  calendarUrl: currentSource.calendarUrl ?? currentSource.serverUrl,
                  serverUrl: currentSource.serverUrl,
                  username: currentSource.username,
                  password: decryptPassword(currentSource.encryptedPassword, encryptionKey),
                  safeFetchOptions: { ...safeFetchOptions, signal },
                  plan: createSourceIngestionPlan(
                    ranges.historicRange,
                    ranges.futureRange,
                  ),
                });
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
                  withPersistenceTransaction:
                    createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                  onIngestEvent: recordIngestWideEvent,
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  reauthentication: {
                    accountId: source.accountId,
                    demand: "authenticated" as const,
                  },
                  shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
              }, {
                onSettledFailure: () => {
                  rejectionIsCurrent = true;
                },
                shouldApplyBackoff: (error) => !shouldTreatAsProviderAuthFailure(error),
              }),
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

              return createAuthenticationRejection({
                accountId: source.accountId,
                credentialIsUnchanged: observedCalDAVCredentialGuard(observedCredential),
                demand: "request-rejected",
                isCurrent: rejectionIsCurrent,
                userId: source.userId,
              });
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
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    settlements,
    caldavSources.map(({ accountId, reauthenticationSource }) => ({
      accountId,
      recordedDemandSource: reauthenticationSource,
    })),
  );
};

const ingestIcsSources = async (): Promise<IngestionBatchResult> => {
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
      ),
    );

  const settlements = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withAbortTimeout((signal, deadlineAt): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", "ical");
          widelog.set("provider.calendar_id", source.calendarId);

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await database
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
                  .limit(1);
                if (!currentSource?.url) {
                  return createSkippedIngestionResult(source.userId);
                }
                const ranges = await getRequiredSourceRanges(source.calendarId);
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
                const ingestionResult = await ingestSource({
                  calendarId: source.calendarId,
                  fetchEvents: () =>
                    fetcher.fetchEvents({
                      interpretEvents: (events, fetchContext) =>
                        interpretFullDayTimedEventsAsAllDay(events, {
                          calendarTimeZone: fetchContext.calendarTimeZone,
                          enabled: currentSource.treatFullDayTimedEventsAsAllDay,
                        }),
                    }),
                  isCurrent,
                  withPersistenceTransaction:
                    createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                  onIngestEvent: recordIngestWideEvent,
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  reauthentication: null,
                  shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
              }),
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
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );

  return summariseIngestionSettlements(
    settlements,
    icsSources.map(() => ({ accountId: null, recordedDemandSource: null })),
  );
};

export default withCronWideEvent({
  async callback() {
    const settlements = await Promise.allSettled([
      ingestOAuthSources(),
      ingestCalDAVSources(),
      ingestIcsSources(),
    ]);
    const failures: unknown[] = [];
    let failedSourceCount = 0;
    const affectedUserIds = new Set<string>();

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
        failures.push(settlement.reason);
        continue;
      }
      failedSourceCount += settlement.value.errors;
      for (const userId of settlement.value.affectedUserIds) {
        affectedUserIds.add(userId);
      }
    }

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
