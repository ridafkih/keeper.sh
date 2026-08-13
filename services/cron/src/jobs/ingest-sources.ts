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
  buildCalendarBackoffState,
  SOURCE_INGEST_LOCK_NAMESPACE,
  createRequiredSourceRanges,
  createSourceIngestionPlan,
} from "@keeper.sh/calendar";
import { INGEST_SOURCE_TIMEOUT_MS, PROVIDER_INGEST_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import type { CalendarBackoffState, IngestionFetchEventsResult, IngestionPersistenceWork, RedisRateLimiter, RequiredSourceRanges, TokenState } from "@keeper.sh/calendar";
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
  isCalDAVAuthenticationError,
} from "@keeper.sh/calendar/caldav";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, isNull, ne, or, sql } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { database, refreshLockRedis, refreshLockStore } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { resolveMissingCalendarFailure } from "@/utils/provider-ingest-failure";
import { resolveOAuthIngestionState } from "@/utils/oauth-ingestion-state";
import { withAbortTimeout } from "@/utils/with-abort-timeout";
import { createSyncLock } from "@keeper.sh/sync";
import { enqueueDestinationSyncsForUsers } from "@/utils/enqueue-destination-syncs";
import { deleteEventStatesInChunks } from "@/utils/delete-event-states";

const SOURCE_TIMEOUT_MS = INGEST_SOURCE_TIMEOUT_MS;
const SOURCE_TIMEOUT_DATABASE_GRACE_MS = 5000;
const SOURCE_CONCURRENCY = 5;
const SOURCE_INGEST_LOCK_KEY_PREFIX = "source-ingest:";
const sourceIngestLock = createSyncLock(refreshLockRedis);

const resetIngestBackoff = async (calendarId: string): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    })
    .where(eq(calendarsTable.id, calendarId));
};

const applyIngestBackoff = async (
  calendarId: string,
  currentFailureCount: number,
): Promise<CalendarBackoffState> => {
  const state = buildCalendarBackoffState(currentFailureCount);
  await database
    .update(calendarsTable)
    .set({
      ingestFailureCount: state.failureCount,
      ingestLastFailureAt: state.lastFailureAt,
      ingestNextAttemptAt: state.nextAttemptAt,
    })
    .where(eq(calendarsTable.id, calendarId));
  return state;
};

const logIngestBackoff = (state: CalendarBackoffState): void => {
  widelog.set("retry.failure_count", state.failureCount);
  if (state.nextAttemptAt) {
    widelog.set("retry.next_attempt_at", state.nextAttemptAt.toISOString());
  }
};

const runSourceIngest = async <TResult>(
  calendarId: string,
  signal: AbortSignal,
  work: (isCurrent: () => Promise<boolean>) => Promise<TResult>,
  shouldApplyBackoff: (error: unknown) => boolean,
): Promise<TResult | null> => {
  const lockResult = await sourceIngestLock.acquire(
    `${SOURCE_INGEST_LOCK_KEY_PREFIX}${calendarId}`,
    signal,
  );
  if (!lockResult.acquired) {
    signal.throwIfAborted();
    return null;
  }
  try {
    const [attempt] = await database
      .select({
        failureCount: calendarsTable.ingestFailureCount,
        nextAttemptAt: calendarsTable.ingestNextAttemptAt,
      })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId))
      .limit(1);
    if (!attempt || attempt.nextAttemptAt && attempt.nextAttemptAt > new Date()) {
      return null;
    }
    try {
      const result = await work(lockResult.handle.isCurrent);
      if (attempt.failureCount > 0 && await lockResult.handle.isCurrent()) {
        await resetIngestBackoff(calendarId);
      }
      return result;
    } catch (error) {
      if (shouldApplyBackoff(error)) {
        logIngestBackoff(await applyIngestBackoff(calendarId, attempt.failureCount));
      }
      throw error;
    }
  } finally {
    await lockResult.handle.release();
  }
};

const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !hasErrorFlag(error, "authRequired") && !hasErrorFlag(error, "oauthReauthRequired");

const recordSkippedResources = (skippedResourceCount: number, reasons: string[]): void => {
  if (skippedResourceCount === 0) {
    return;
  }
  widelog.set("provider.resources_skipped", skippedResourceCount);
  widelog.set("provider.resources_skipped_reasons", reasons.join("; "));
};

const resolveIngestErrorSlug = (error: unknown): string => {
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

interface IngestionSourceResult {
  eventsAdded: number;
  eventsRemoved: number;
  ingestEvents: Record<string, unknown>[];
  shouldPush: boolean;
  userId: string;
}

interface IngestionBatchResult {
  added: number;
  affectedUserIds: string[];
  errors: number;
  ingestEvents: Record<string, unknown>[];
  removed: number;
}

const createSkippedIngestionResult = (userId: string): IngestionSourceResult => ({
  eventsAdded: 0,
  eventsRemoved: 0,
  ingestEvents: [],
  shouldPush: false,
  userId,
});

const ingestOAuthSources = async (): Promise<IngestionBatchResult> => {
  const oauthSources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
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

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];
  const affectedUserIds = new Set<string>();

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
                if (rawRefresher) {
                  const tokenRefresher = createCoordinatedRefresher({
                    database,
                    oauthCredentialId: currentSource.oauthCredentialId,
                    calendarAccountId: currentSource.accountId,
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
                const ingestEvents: Record<string, unknown>[] = [];
                const ingestionResult = await ingestSource({
                  calendarId: source.calendarId,
                  fetchEvents: () => fetcher.fetchEvents(),
                  isCurrent,
                  withPersistenceTransaction:
                    createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                  onIngestEvent: (event) => {
                    ingestEvents.push({
                      ...event,
                      "source.provider": currentSource.provider,
                    });
                  },
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  ingestEvents,
                  shouldPush: ingestionState.authorityChanged
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
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

            const missingCalendarFailure = resolveMissingCalendarFailure(error);
            if (missingCalendarFailure) {
              widelog.errorFields(error, missingCalendarFailure);
              throw error;
            }

            if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [], shouldPush: false, userId: source.userId };
            }

            if (error instanceof Error && "oauthReauthRequired" in error && error.oauthReauthRequired === true) {
              widelog.errorFields(error, { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [], shouldPush: false, userId: source.userId };
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

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      added += settlement.value.eventsAdded;
      removed += settlement.value.eventsRemoved;
      allIngestEvents.push(...settlement.value.ingestEvents);
      if (settlement.value.shouldPush) {
        affectedUserIds.add(settlement.value.userId);
      }
    } else {
      errors += 1;
    }
  }

  return { added, affectedUserIds: [...affectedUserIds], removed, errors, ingestEvents: allIngestEvents };
};

const ingestCalDAVSources = async (): Promise<IngestionBatchResult> => {
  if (!env.ENCRYPTION_KEY) {
    return { added: 0, affectedUserIds: [], removed: 0, errors: 0, ingestEvents: [] };
  }

  const encryptionKey = env.ENCRYPTION_KEY;

  const caldavSources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      calendarUrl: calendarsTable.calendarUrl,
      provider: calendarAccountsTable.provider,
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

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];
  const affectedUserIds = new Set<string>();

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

          try {
            const result = await widelog.time.measure("duration_ms", () =>
              runSourceIngest(source.calendarId, signal, async (isCurrent) => {
                const [currentSource] = await database
                  .select({
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
                const ingestEvents: Record<string, unknown>[] = [];
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
                  onIngestEvent: (event) => {
                    ingestEvents.push({
                      ...event,
                      "source.provider": currentSource.provider,
                    });
                  },
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  ingestEvents,
                  shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
              }, (error) => !isCalDAVAuthenticationError(error)),
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

            if (isCalDAVAuthenticationError(error)) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [], shouldPush: false, userId: source.userId };
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

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      added += settlement.value.eventsAdded;
      removed += settlement.value.eventsRemoved;
      allIngestEvents.push(...settlement.value.ingestEvents);
      if (settlement.value.shouldPush) {
        affectedUserIds.add(settlement.value.userId);
      }
    } else {
      errors += 1;
    }
  }

  return { added, affectedUserIds: [...affectedUserIds], removed, errors, ingestEvents: allIngestEvents };
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

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];
  const affectedUserIds = new Set<string>();

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
                const ingestEvents: Record<string, unknown>[] = [];
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
                  onIngestEvent: (event) => {
                    ingestEvents.push({
                      ...event,
                      "source.provider": "ical",
                    });
                  },
                });
                return {
                  eventsAdded: ingestionResult.eventsAdded,
                  eventsRemoved: ingestionResult.eventsRemoved,
                  ingestEvents,
                  shouldPush: hasSourceAuthorityChanged(currentSource, ranges)
                    || ingestionResult.eventsAdded > 0
                    || ingestionResult.eventsRemoved > 0,
                  userId: currentSource.userId,
                };
              }, () => true),
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

  for (const settlement of settlements) {
    if (settlement.status === "fulfilled") {
      added += settlement.value.eventsAdded;
      removed += settlement.value.eventsRemoved;
      allIngestEvents.push(...settlement.value.ingestEvents);
      if (settlement.value.shouldPush) {
        affectedUserIds.add(settlement.value.userId);
      }
    } else {
      errors += 1;
    }
  }

  return { added, affectedUserIds: [...affectedUserIds], removed, errors, ingestEvents: allIngestEvents };
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
