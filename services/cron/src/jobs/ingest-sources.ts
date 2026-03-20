import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
  ensureValidToken,
} from "@keeper.sh/calendar";
import type { IngestionChanges, TokenState } from "@keeper.sh/calendar";
import { createIcsSourceFetcher } from "@keeper.sh/calendar/ics";
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
import { RedisCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { context, widelog } from "@/utils/logging";
import { createMachineRuntimeWidelogSink } from "@/utils/machine-runtime-widelog";
import { database, refreshLockRedis } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { createSourceIngestionLifecycleRuntime } from "./source-ingestion-lifecycle-runtime";
import {
  OAuthIngestionResolutionStatus,
  createOAuthIngestionResolutionDependencies,
  resolveOAuthIngestionResolution,
} from "../lib/oauth-ingestion-resolution";

const SOURCE_TIMEOUT_MS = 60_000;
const SOURCE_CONCURRENCY = 5;
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

type IngestionFailureEventType = "AUTH_FAILURE" | "NOT_FOUND" | "TRANSIENT_FAILURE";

interface IngestionFailureDecision {
  eventType: IngestionFailureEventType;
  code: string;
  logSlug: string;
  requiresReauth: boolean;
  retriable: boolean;
}

const dispatchEmptyIngestionSuccess = async (input: {
  sourceRuntime: ReturnType<typeof createSourceIngestionLifecycleRuntime>;
}): Promise<IngestionSourceResult> => {
  await input.sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
  await input.sourceRuntime.dispatch({
    eventsAdded: 0,
    eventsRemoved: 0,
    type: "INGEST_SUCCEEDED",
  });
  widelog.set("outcome", "success");
  widelog.set("sync.events_added", 0);
  widelog.set("sync.events_removed", 0);
  return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
};

const dispatchIngestionSuccess = async (input: {
  eventsAdded: number;
  eventsRemoved: number;
  nextSyncToken?: string;
  sourceRuntime: ReturnType<typeof createSourceIngestionLifecycleRuntime>;
}): Promise<void> => {
  widelog.set("sync.events_added", input.eventsAdded);
  widelog.set("sync.events_removed", input.eventsRemoved);

  await input.sourceRuntime.dispatch({ type: "FETCH_SUCCEEDED" });
  await input.sourceRuntime.dispatch({
    eventsAdded: input.eventsAdded,
    eventsRemoved: input.eventsRemoved,
    nextSyncToken: input.nextSyncToken,
    type: "INGEST_SUCCEEDED",
  });

  widelog.set("outcome", "success");
};

const createSourceRuntime = (input: {
  provider: string;
  sourceId: string;
  disableSource: () => Promise<void>;
  markNeedsReauth: () => Promise<void>;
  persistSyncToken: (syncToken: string) => Promise<void>;
}) =>
  createSourceIngestionLifecycleRuntime({
    handlers: {
      disableSource: input.disableSource,
      markNeedsReauth: input.markNeedsReauth,
      persistSyncToken: input.persistSyncToken,
    },
    outboxStore: new RedisCommandOutboxStore({
      keyPrefix: "machine:outbox:source-ingestion-lifecycle",
      redis: refreshLockRedis,
    }),
    onRuntimeEvent: createMachineRuntimeWidelogSink(
      "source_ingestion_lifecycle",
      (field, value) => {
        widelog.set(field, value);
      },
    ),
    provider: input.provider,
    sourceId: input.sourceId,
  });

const classifyIngestionFailure = (
  error: unknown,
  input?: {
    authFailureSlug?: string;
    isAuthFailure?: (error: unknown) => boolean;
  },
): IngestionFailureDecision => {
  if (input?.isAuthFailure?.(error)) {
    return {
      eventType: "AUTH_FAILURE",
      code: "auth_required",
      logSlug: input.authFailureSlug ?? "provider-auth-failed",
      requiresReauth: true,
      retriable: false,
    };
  }

  if (isNotFoundError(error) || (error instanceof Error && error.message.includes("404"))) {
    return {
      eventType: "NOT_FOUND",
      code: resolveIngestionErrorCode(error),
      logSlug: "provider-calendar-not-found",
      requiresReauth: false,
      retriable: false,
    };
  }

  return {
    eventType: "TRANSIENT_FAILURE",
    code: resolveIngestionErrorCode(error),
    logSlug: "provider-api-error",
    requiresReauth: false,
    retriable: true,
  };
};

const ingestOAuthSources = async (): Promise<{ added: number; removed: number; errors: number; ingestEvents: Record<string, unknown>[] }> => {
  const oauthResolutionDependencies = createOAuthIngestionResolutionDependencies(refreshLockRedis);
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
          const sourceRuntime = createSourceRuntime({
            provider: source.provider,
            sourceId: source.calendarId,
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
          });

          try {
            await sourceRuntime.dispatch({ type: "SOURCE_SELECTED" });
            await sourceRuntime.dispatch({ type: "FETCHER_RESOLVED" });

            const resolution = resolveOAuthIngestionResolution({
              accessToken: source.accessToken,
              externalCalendarId: source.externalCalendarId,
              oauthConfig: {
                googleClientId: env.GOOGLE_CLIENT_ID,
                googleClientSecret: env.GOOGLE_CLIENT_SECRET,
                microsoftClientId: env.MICROSOFT_CLIENT_ID,
                microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
              },
              provider: source.provider,
              syncToken: source.syncToken,
              userId: source.userId,
            }, oauthResolutionDependencies);

            if (resolution.status !== OAuthIngestionResolutionStatus.RESOLVED) {
              return dispatchEmptyIngestionSuccess({ sourceRuntime });
            }

            const tokenState: TokenState = {
              accessToken: source.accessToken,
              accessTokenExpiresAt: source.expiresAt,
              refreshToken: source.refreshToken,
            };

            await ensureValidToken(tokenState, resolution.tokenRefresher);
            const ingestEvents: Record<string, unknown>[] = [];

            const result = await widelog.time.measure("duration_ms", () =>
              ingestSource({
                calendarId: source.calendarId,
                fetchEvents: () => resolution.fetcher.fetchEvents(),
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

            await dispatchIngestionSuccess({
              sourceRuntime,
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
            });

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");
            const failureDecision = classifyIngestionFailure(error, {
              authFailureSlug: "provider-token-refresh-failed",
              isAuthFailure: isOAuthAuthFailure,
            });

            await sourceRuntime.dispatch({
              code: failureDecision.code,
              type: failureDecision.eventType,
            });
            widelog.errorFields(error, {
              slug: failureDecision.logSlug,
              retriable: failureDecision.retriable,
              requiresReauth: failureDecision.requiresReauth,
            });
            if (failureDecision.retriable) {
              throw error;
            }
            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
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
          const sourceRuntime = createSourceRuntime({
            provider: source.provider,
            sourceId: source.calendarId,
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

            await dispatchIngestionSuccess({
              sourceRuntime,
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
            });

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");
            const failureDecision = classifyIngestionFailure(error, {
              authFailureSlug: "provider-auth-failed",
              isAuthFailure: isCalDAVAuthenticationError,
            });

            await sourceRuntime.dispatch({
              code: failureDecision.code,
              type: failureDecision.eventType,
            });
            widelog.errorFields(error, {
              slug: failureDecision.logSlug,
              retriable: failureDecision.retriable,
              requiresReauth: failureDecision.requiresReauth,
            });
            if (failureDecision.retriable) {
              throw error;
            }
            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
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
          const sourceRuntime = createSourceRuntime({
            provider: "ical",
            sourceId: source.calendarId,
            disableSource: async () => {
              await database
                .update(calendarsTable)
                .set({ disabled: true })
                .where(eq(calendarsTable.id, source.calendarId));
            },
            markNeedsReauth: () => Promise.resolve(),
            persistSyncToken: () => Promise.resolve(),
          });

          try {
            await sourceRuntime.dispatch({ type: "SOURCE_SELECTED" });
            await sourceRuntime.dispatch({ type: "FETCHER_RESOLVED" });

            if (!source.url) {
              return dispatchEmptyIngestionSuccess({ sourceRuntime });
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

            await dispatchIngestionSuccess({
              sourceRuntime,
              eventsAdded: result.eventsAdded,
              eventsRemoved: result.eventsRemoved,
            });

            return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
          } catch (error) {

            widelog.set("outcome", "error");
            const failureDecision = classifyIngestionFailure(error);
            await sourceRuntime.dispatch({
              code: failureDecision.code,
              type: failureDecision.eventType,
            });
            widelog.errorFields(error, {
              slug: failureDecision.logSlug,
              retriable: failureDecision.retriable,
              requiresReauth: failureDecision.requiresReauth,
            });
            if (failureDecision.retriable) {
              throw error;
            }
            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
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
