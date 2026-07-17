import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
  buildEventStateInsertRow,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createCoordinatedRefresher,
  createRedisRateLimiter,
  ensureValidToken,
  isTimeoutError,
  buildCalendarBackoffState,
  SOURCE_INGEST_LOCK_NAMESPACE,
} from "@keeper.sh/calendar";
import { INGEST_SOURCE_TIMEOUT_MS, PROVIDER_INGEST_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import type { CalendarBackoffState, IngestionFetchEventsResult, IngestionPersistenceWork, RedisRateLimiter, TokenState } from "@keeper.sh/calendar";
import {
  createIcsSourceFetcher,
  interpretFullDayTimedEventsAsAllDay,
  persistCalendarSnapshot,
} from "@keeper.sh/calendar/ics";
import { createGoogleSourceFetcher } from "@keeper.sh/calendar/google";
import { createOutlookSourceFetcher } from "@keeper.sh/calendar/outlook";
import { createCalDAVSourceFetcher, isCalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { database, refreshLockRedis, refreshLockStore } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { resolveMissingCalendarFailure } from "@/utils/provider-ingest-failure";
import { withAbortTimeout } from "@/utils/with-abort-timeout";

const SOURCE_TIMEOUT_MS = INGEST_SOURCE_TIMEOUT_MS;
const SOURCE_TIMEOUT_DATABASE_GRACE_MS = 5000;
const SOURCE_CONCURRENCY = 5;
const resolveIngestErrorSlug = (error: unknown): string => {
  if (!isTimeoutError(error)) {
    return "provider-api-error";
  }
  widelog.set("timeout.fired", true);
  widelog.set("timeout.kind", "request");
  widelog.set("timeout.limit_ms", PROVIDER_INGEST_REQUEST_TIMEOUT_MS);
  return "provider-request-timeout";
};
const GOOGLE_REQUESTS_PER_MINUTE = 500;

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
          await transaction
            .delete(eventStatesTable)
            .where(
              and(
                eq(eventStatesTable.calendarId, calendarId),
                inArray(eventStatesTable.id, changes.deletes),
              ),
            );
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

  return createRedisRateLimiter(
    refreshLockRedis,
    `ratelimit:${userId}:google`,
    { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
  );
};

interface OAuthFetcherParams {
  accessToken: string;
  externalCalendarId: string;
  syncToken: string | null;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
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
}

const ingestOAuthSources = async (): Promise<{ added: number; removed: number; errors: number; ingestEvents: Record<string, unknown>[] }> => {
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
      ingestFailureCount: calendarsTable.ingestFailureCount,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        or(
          isNull(calendarsTable.ingestNextAttemptAt),
          lte(calendarsTable.ingestNextAttemptAt, new Date()),
        ),
      ),
    );

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];

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
            if (!source.externalCalendarId) {
  
              widelog.set("outcome", "success");
              widelog.set("sync.events_added", 0);
              widelog.set("sync.events_removed", 0);
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            const rawRefresher = resolveTokenRefresher(source.provider);
            const tokenState: TokenState = {
              accessToken: source.accessToken,
              accessTokenExpiresAt: source.expiresAt,
              refreshToken: source.refreshToken,
            };

            if (rawRefresher) {
              const tokenRefresher = createCoordinatedRefresher({
                database,
                oauthCredentialId: source.oauthCredentialId,
                calendarAccountId: source.accountId,
                refreshLockStore,
                rawRefresh: rawRefresher,
              });
              await ensureValidToken(tokenState, tokenRefresher);
            }

            const rateLimiter = resolveRateLimiter(source.provider, source.userId);

            const resolvedFetcher = resolveOAuthFetcher(source.provider, {
              accessToken: tokenState.accessToken,
              externalCalendarId: source.externalCalendarId,
              syncToken: source.syncToken,
              rateLimiter,
              signal,
            });

            if (!resolvedFetcher) {
  
              widelog.set("outcome", "success");
              widelog.set("sync.events_added", 0);
              widelog.set("sync.events_removed", 0);
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            const fetcher = resolvedFetcher;
            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                withPersistenceTransaction:
                  createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": source.provider,
                  });
                },
              }),
            );

            if (source.ingestFailureCount > 0) {
              await resetIngestBackoff(source.calendarId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");

            const missingCalendarFailure = resolveMissingCalendarFailure(error);
            if (missingCalendarFailure) {
              widelog.errorFields(error, missingCalendarFailure);
              logIngestBackoff(
                await applyIngestBackoff(source.calendarId, source.ingestFailureCount),
              );
              throw error;
            }

            if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            if (error instanceof Error && "oauthReauthRequired" in error && error.oauthReauthRequired === true) {
              widelog.errorFields(error, { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            widelog.errorFields(error, {
              slug: resolveIngestErrorSlug(error),
              retriable: true,
            });
            logIngestBackoff(
              await applyIngestBackoff(source.calendarId, source.ingestFailureCount),
            );
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
    } else {
      errors += 1;
    }
  }

  return { added, removed, errors, ingestEvents: allIngestEvents };
};

const ingestCalDAVSources = async (): Promise<{ added: number; removed: number; errors: number; ingestEvents: Record<string, unknown>[] }> => {
  if (!env.ENCRYPTION_KEY) {
    return { added: 0, removed: 0, errors: 0, ingestEvents: [] };
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
      ingestFailureCount: calendarsTable.ingestFailureCount,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(caldavCredentialsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        or(
          isNull(calendarsTable.ingestNextAttemptAt),
          lte(calendarsTable.ingestNextAttemptAt, new Date()),
        ),
      ),
    );

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];

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
            const password = decryptPassword(source.encryptedPassword, encryptionKey);

            const fetcher = createCalDAVSourceFetcher({
              calendarUrl: source.calendarUrl ?? source.serverUrl,
              serverUrl: source.serverUrl,
              username: source.username,
              password,
              safeFetchOptions: { ...safeFetchOptions, signal },
            });

            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                withPersistenceTransaction:
                  createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": source.provider,
                  });
                },
              }),
            );

            if (source.ingestFailureCount > 0) {
              await resetIngestBackoff(source.calendarId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");

            if (isCalDAVAuthenticationError(error)) {
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });

              await database
                .update(calendarAccountsTable)
                .set({ needsReauthentication: true })
                .where(eq(calendarAccountsTable.id, source.accountId));

              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
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

            logIngestBackoff(
              await applyIngestBackoff(source.calendarId, source.ingestFailureCount),
            );

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
    } else {
      errors += 1;
    }
  }

  return { added, removed, errors, ingestEvents: allIngestEvents };
};

const ingestIcsSources = async (): Promise<{ added: number; removed: number; errors: number; ingestEvents: Record<string, unknown>[] }> => {
  const icsSources = await database
    .select({
      calendarId: calendarsTable.id,
      url: calendarsTable.url,
      treatFullDayTimedEventsAsAllDay: calendarsTable.treatFullDayTimedEventsAsAllDay,
      userId: calendarsTable.userId,
      ingestFailureCount: calendarsTable.ingestFailureCount,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.calendarType, "ical"),
        eq(calendarsTable.disabled, false),
        or(
          isNull(calendarsTable.ingestNextAttemptAt),
          lte(calendarsTable.ingestNextAttemptAt, new Date()),
        ),
      ),
    );

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];

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
            if (!source.url) {
  
              widelog.set("outcome", "success");
              widelog.set("sync.events_added", 0);
              widelog.set("sync.events_removed", 0);
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            const fetcher = createIcsSourceFetcher({
              calendarId: source.calendarId,
              url: source.url,
              database,
              safeFetchOptions: { ...safeFetchOptions, signal },
            });

            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () =>
                  fetcher.fetchEvents({
                    interpretEvents: (events, fetchContext) =>
                      interpretFullDayTimedEventsAsAllDay(events, {
                        calendarTimeZone: fetchContext.calendarTimeZone,
                        enabled: source.treatFullDayTimedEventsAsAllDay,
                      }),
                  }),
                withPersistenceTransaction:
                  createIngestionPersistenceTransaction(source.calendarId, signal, deadlineAt),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": "ical",
                  });
                },
              }),
            );

            if (source.ingestFailureCount > 0) {
              await resetIngestBackoff(source.calendarId);
            }

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");
            widelog.errorFields(error, {
              slug: resolveIngestErrorSlug(error),
              retriable: true,
            });
            logIngestBackoff(
              await applyIngestBackoff(source.calendarId, source.ingestFailureCount),
            );
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
    } else {
      errors += 1;
    }
  }

  return { added, removed, errors, ingestEvents: allIngestEvents };
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

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
        failures.push(settlement.reason);
        continue;
      }
      failedSourceCount += settlement.value.errors;
    }

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
