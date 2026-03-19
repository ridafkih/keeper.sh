import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
  createGoogleOAuthService,
  createMicrosoftOAuthService,
  createRedisRateLimiter,
  ensureValidToken,
} from "@keeper.sh/calendar";
import type { IngestionChanges, IngestionFetchEventsResult, RedisRateLimiter, TokenState } from "@keeper.sh/calendar";
import { createIcsSourceFetcher } from "@keeper.sh/calendar/ics";
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
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { createMachineRuntimeWidelogSink } from "@/utils/machine-runtime-widelog";
import { database, refreshLockRedis } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { createSourceIngestionLifecycleRuntime } from "./source-ingestion-lifecycle-runtime";

const SOURCE_TIMEOUT_MS = 60_000;
const SOURCE_CONCURRENCY = 5;
const GOOGLE_REQUESTS_PER_MINUTE = 500;

const serializeOptionalJson = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const withTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> =>
  Promise.race([
    Promise.resolve().then(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`Source ingestion timed out after ${timeoutMs}ms`);
    }),
  ]);

const createIngestionFlush = (calendarId: string) =>
  async (changes: IngestionChanges): Promise<void> => {
    await database.transaction(async (transaction) => {
      if (changes.deletes.length > 0) {
        await transaction
          .delete(eventStatesTable)
          .where(
            and(
              eq(eventStatesTable.calendarId, calendarId),
              inArray(eventStatesTable.id, changes.deletes),
            ),
          );
      }

      if (changes.inserts.length > 0) {
        await insertEventStatesWithConflictResolution(
          transaction,
          changes.inserts.map((event) => ({
            availability: event.availability,
            calendarId,
            description: event.description,
            endTime: event.endTime,
            exceptionDates: serializeOptionalJson(event.exceptionDates),
            isAllDay: event.isAllDay,
            location: event.location,
            recurrenceRule: serializeOptionalJson(event.recurrenceRule),
            sourceEventType: event.sourceEventType,
            sourceEventUid: event.uid,
            startTime: event.startTime,
            startTimeZone: event.startTimeZone,
            title: event.title,
          })),
        );
      }

      if ("syncToken" in changes) {
        await transaction
          .update(calendarsTable)
          .set({ syncToken: changes.syncToken })
          .where(eq(calendarsTable.id, calendarId));
      }
    });
  };

const readExistingEvents = (calendarId: string) =>
  database
    .select({
      availability: eventStatesTable.availability,
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
      sourceEventType: eventStatesTable.sourceEventType,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));

const resolveTokenRefresher = (provider: string) => {
  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const googleOAuth = createGoogleOAuthService({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
    return (refreshToken: string) => googleOAuth.refreshAccessToken(refreshToken);
  }

  if (provider === "outlook" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    const microsoftOAuth = createMicrosoftOAuthService({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
    return (refreshToken: string) => microsoftOAuth.refreshAccessToken(refreshToken);
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

const resolveIngestionErrorCode = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes("timed out")) {
      return "timeout";
    }
    if (error.message.includes("404")) {
      return "not_found";
    }
    return "transient_failure";
  }
  return "unknown_error";
};

const isNotFoundError = (error: unknown): boolean => error instanceof Error && "status" in error && error.status === 404;

const isOAuthAuthFailure = (error: unknown): boolean => {
  if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
    return true;
  }
  if (error instanceof Error && "oauthReauthRequired" in error && error.oauthReauthRequired === true) {
    return true;
  }
  return false;
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
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      userId: calendarsTable.userId,
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

  const settlements = await allSettledWithConcurrency(
    oauthSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
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
          const onRuntimeEvent = createMachineRuntimeWidelogSink(
            "source_ingestion_lifecycle",
            (field, value) => {
              widelog.set(field, value);
            },
          );

          const sourceRuntime = createSourceIngestionLifecycleRuntime({
            handlers: {
              disableSource: async () => {
                await database
                  .update(calendarsTable)
                  .set({ disabled: true })
                  .where(eq(calendarsTable.id, source.calendarId));
              },
              markNeedsReauth: async () => {
                await database
                  .update(calendarAccountsTable)
                  .set({ needsReauthentication: true })
                  .where(eq(calendarAccountsTable.id, source.accountId));
              },
              persistSyncToken: async (syncToken) => {
                await database
                  .update(calendarsTable)
                  .set({ syncToken })
                  .where(eq(calendarsTable.id, source.calendarId));
              },
            },
            onRuntimeEvent,
            provider: source.provider,
            sourceId: source.calendarId,
          });

          try {
            await sourceRuntime.dispatch({ type: "SOURCE_SELECTED" });
            await sourceRuntime.dispatch({ type: "FETCHER_RESOLVED" });

            if (!source.externalCalendarId) {
              await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
              await sourceRuntime.dispatch({
                eventsAdded: 0,
                eventsRemoved: 0,
                type: "INGEST_SUCCEEDED",
              });
              widelog.set("outcome", "success");
              widelog.set("sync.events_added", 0);
              widelog.set("sync.events_removed", 0);
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            const tokenRefresher = resolveTokenRefresher(source.provider);
            const tokenState: TokenState = {
              accessToken: source.accessToken,
              accessTokenExpiresAt: source.expiresAt,
              refreshToken: source.refreshToken,
            };

            if (tokenRefresher) {
              await ensureValidToken(tokenState, tokenRefresher);
            }

            const rateLimiter = resolveRateLimiter(source.provider, source.userId);

            const resolvedFetcher = resolveOAuthFetcher(source.provider, {
              accessToken: tokenState.accessToken,
              externalCalendarId: source.externalCalendarId,
              syncToken: source.syncToken,
              rateLimiter,
            });

            if (!resolvedFetcher) {
              await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
              await sourceRuntime.dispatch({
                eventsAdded: 0,
                eventsRemoved: 0,
                type: "INGEST_SUCCEEDED",
              });
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
                readExistingEvents: () => readExistingEvents(source.calendarId),
                flush: createIngestionFlush(source.calendarId),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": source.provider,
                  });
                },
              }),
            );

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
            await sourceRuntime.dispatch({
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
              type: "INGEST_SUCCEEDED",
            });

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");

            if (isNotFoundError(error)) {
              await sourceRuntime.dispatch({
                code: resolveIngestionErrorCode(error),
                type: "NOT_FOUND",
              });
              widelog.errorFields(error, { slug: "provider-calendar-not-found", retriable: false });
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            if (isOAuthAuthFailure(error)) {
              await sourceRuntime.dispatch({
                code: "auth_required",
                type: "AUTH_FAILURE",
              });
              widelog.errorFields(error, { slug: "provider-token-refresh-failed", retriable: false, requiresReauth: true });
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            await sourceRuntime.dispatch({
              code: resolveIngestionErrorCode(error),
              type: "TRANSIENT_FAILURE",
            });
            widelog.errorFields(error, { slug: "provider-api-error", retriable: true });
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

  const settlements = await allSettledWithConcurrency(
    caldavSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", source.provider);
          widelog.set("provider.account_id", source.accountId);
          widelog.set("provider.calendar_id", source.calendarId);
          const onRuntimeEvent = createMachineRuntimeWidelogSink(
            "source_ingestion_lifecycle",
            (field, value) => {
              widelog.set(field, value);
            },
          );

          const sourceRuntime = createSourceIngestionLifecycleRuntime({
            handlers: {
              disableSource: async () => {
                await database
                  .update(calendarsTable)
                  .set({ disabled: true })
                  .where(eq(calendarsTable.id, source.calendarId));
              },
              markNeedsReauth: async () => {
                await database
                  .update(calendarAccountsTable)
                  .set({ needsReauthentication: true })
                  .where(eq(calendarAccountsTable.id, source.accountId));
              },
              persistSyncToken: () => Promise.resolve(),
            },
            onRuntimeEvent,
            provider: source.provider,
            sourceId: source.calendarId,
          });

          try {
            await sourceRuntime.dispatch({ type: "SOURCE_SELECTED" });
            await sourceRuntime.dispatch({ type: "FETCHER_RESOLVED" });

            const password = decryptPassword(source.encryptedPassword, encryptionKey);

            const fetcher = createCalDAVSourceFetcher({
              calendarUrl: source.calendarUrl ?? source.serverUrl,
              serverUrl: source.serverUrl,
              username: source.username,
              password,
              safeFetchOptions,
            });

            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                readExistingEvents: () => readExistingEvents(source.calendarId),
                flush: createIngestionFlush(source.calendarId),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": source.provider,
                  });
                },
              }),
            );

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
            await sourceRuntime.dispatch({
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
              type: "INGEST_SUCCEEDED",
            });

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");

            if (isCalDAVAuthenticationError(error)) {
              await sourceRuntime.dispatch({
                code: "auth_required",
                type: "AUTH_FAILURE",
              });
              widelog.errorFields(error, { slug: "provider-auth-failed", retriable: false, requiresReauth: true });
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            if (error instanceof Error && error.message.includes("404")) {
              await sourceRuntime.dispatch({
                code: resolveIngestionErrorCode(error),
                type: "NOT_FOUND",
              });
              widelog.errorFields(error, { slug: "provider-calendar-not-found", retriable: false });
            } else {
              await sourceRuntime.dispatch({
                code: resolveIngestionErrorCode(error),
                type: "TRANSIENT_FAILURE",
              });
              widelog.errorFields(error, { slug: "provider-api-error", retriable: true });
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
      userId: calendarsTable.userId,
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

  const settlements = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        context(async () => {
          widelog.set("operation.name", "ingest-source");
          widelog.set("operation.type", "job");
          widelog.set("sync.direction", "ingest");
          widelog.set("user.id", source.userId);
          widelog.set("provider.name", "ical");
          widelog.set("provider.calendar_id", source.calendarId);
          const onRuntimeEvent = createMachineRuntimeWidelogSink(
            "source_ingestion_lifecycle",
            (field, value) => {
              widelog.set(field, value);
            },
          );

          const sourceRuntime = createSourceIngestionLifecycleRuntime({
            handlers: {
              disableSource: async () => {
                await database
                  .update(calendarsTable)
                  .set({ disabled: true })
                  .where(eq(calendarsTable.id, source.calendarId));
              },
              markNeedsReauth: () => Promise.resolve(),
              persistSyncToken: () => Promise.resolve(),
            },
            onRuntimeEvent,
            provider: "ical",
            sourceId: source.calendarId,
          });

          try {
            await sourceRuntime.dispatch({ type: "SOURCE_SELECTED" });
            await sourceRuntime.dispatch({ type: "FETCHER_RESOLVED" });

            if (!source.url) {
              await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
              await sourceRuntime.dispatch({
                eventsAdded: 0,
                eventsRemoved: 0,
                type: "INGEST_SUCCEEDED",
              });
              widelog.set("outcome", "success");
              widelog.set("sync.events_added", 0);
              widelog.set("sync.events_removed", 0);
              return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
            }

            const fetcher = createIcsSourceFetcher({
              calendarId: source.calendarId,
              url: source.url,
              database,
              safeFetchOptions,
            });

            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                readExistingEvents: () => readExistingEvents(source.calendarId),
                flush: createIngestionFlush(source.calendarId),
                onIngestEvent: (event) => {
                  ingestEvents.push({
                    ...event,
                    "source.provider": "ical",
                  });
                },
              }),
            );

            widelog.set("sync.events_added", result.eventsAdded);
            widelog.set("sync.events_removed", result.eventsRemoved);

            await sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
            await sourceRuntime.dispatch({
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
              type: "INGEST_SUCCEEDED",
            });

            widelog.set("outcome", "success");

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");
            await sourceRuntime.dispatch({
              code: resolveIngestionErrorCode(error),
              type: "TRANSIENT_FAILURE",
            });
            widelog.errorFields(error, { slug: "provider-api-error", retriable: true });
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
    await Promise.allSettled([
      ingestOAuthSources(),
      ingestCalDAVSources(),
      ingestIcsSources(),
    ]);
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: "ingest-sources",
  overrunProtection: false,
}) satisfies CronOptions;
