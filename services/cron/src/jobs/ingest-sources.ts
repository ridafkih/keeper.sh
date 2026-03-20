import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
  ensureValidToken,
  createIcsSourceFetcher,
  createCalDAVSourceFetcher,
  isCalDAVAuthenticationError,
} from "@keeper.sh/calendar";
import type { IngestionChanges, TokenState } from "@keeper.sh/calendar";
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
import { createSourceIngestionLifecycleRuntime } from "../lib/source-ingestion-lifecycle-runtime";
import {
  OAuthIngestionResolutionStatus,
  createOAuthIngestionResolutionDependencies,
  resolveOAuthIngestionResolution,
} from "../lib/oauth-ingestion-resolution";
import {
  runSourceIngestionUnit,
  type SourceIngestionLogger,
} from "../lib/source-ingestion-runner";
import {
  classifySourceIngestionFailure,
  SourceIngestionFailureLogSlug,
} from "../lib/source-ingestion-failure";
import { summarizeIngestionSettlements } from "../lib/ingestion-settlement-summary";

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

const createSourceRuntime = (input: {
  provider: string;
  sourceId: string;
  disableSource: () => Promise<void>;
  markNeedsReauth: () => Promise<void>;
  persistSyncToken: (syncToken: string) => Promise<void>;
}) => {
  let envelopeSequence = 0;
  return createSourceIngestionLifecycleRuntime({
    createEnvelope: (event) => {
      envelopeSequence += 1;
      return {
        actor: { id: "cron-ingest", type: "system" },
        event,
        id: `${input.sourceId}:${envelopeSequence}:${event.type}`,
        occurredAt: new Date().toISOString(),
      };
    },
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
};

const createSourceIngestionLogger = (): SourceIngestionLogger => ({
  errorFields: (error, fields) => {
    widelog.errorFields(error, fields);
  },
  flush: () => {
    widelog.flush();
  },
  measureDuration: <TResult>(operation: () => Promise<TResult>) =>
    widelog.time.measure("duration_ms", operation),
  set: (field, value) => {
    widelog.set(field, value as Parameters<typeof widelog.set>[1]);
  },
});

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

  const settlements = await allSettledWithConcurrency(
    oauthSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        context(() => {
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

          const logger = createSourceIngestionLogger();
          return runSourceIngestionUnit({
            classifyFailure: (error) =>
              classifySourceIngestionFailure(
                error,
                { isNotFoundError, resolveErrorCode: resolveIngestionErrorCode },
                {
                  authFailureSlug: SourceIngestionFailureLogSlug.TOKEN_REFRESH_FAILED,
                  isAuthFailure: isOAuthAuthFailure,
                },
              ),
            executeIngest: async () => {
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
                return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
              }

              const tokenState: TokenState = {
                accessToken: source.accessToken,
                accessTokenExpiresAt: source.expiresAt,
                refreshToken: source.refreshToken,
              };
              await ensureValidToken(tokenState, resolution.tokenRefresher);

              const ingestEvents: Record<string, unknown>[] = [];
              const ingestResult = await ingestSource({
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
              });
              return {
                eventsAdded: ingestResult.eventsAdded,
                eventsRemoved: ingestResult.eventsRemoved,
                ingestEvents,
              };
            },
            logger,
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
              externalCalendarId: source.externalCalendarId,
              provider: source.provider,
              userId: source.userId,
            },
            runtime: sourceRuntime,
          });
        }),
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );
  return summarizeIngestionSettlements(settlements);
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

  const settlements = await allSettledWithConcurrency(
    caldavSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        context(() => {
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

          const logger = createSourceIngestionLogger();
          return runSourceIngestionUnit({
            classifyFailure: (error) =>
              classifySourceIngestionFailure(
                error,
                { isNotFoundError, resolveErrorCode: resolveIngestionErrorCode },
                {
                  authFailureSlug: SourceIngestionFailureLogSlug.AUTH_FAILED,
                  isAuthFailure: isCalDAVAuthenticationError,
                },
              ),
            executeIngest: async () => {
              const password = decryptPassword(source.encryptedPassword, encryptionKey);
              const fetcher = createCalDAVSourceFetcher({
                calendarUrl: source.calendarUrl ?? source.serverUrl,
                password,
                safeFetchOptions,
                serverUrl: source.serverUrl,
                username: source.username,
              });

              const ingestEvents: Record<string, unknown>[] = [];
              const ingestResult = await ingestSource({
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
              });
              return {
                eventsAdded: ingestResult.eventsAdded,
                eventsRemoved: ingestResult.eventsRemoved,
                ingestEvents,
              };
            },
            logger,
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
              provider: source.provider,
              userId: source.userId,
            },
            runtime: sourceRuntime,
          });
        }),
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );
  return summarizeIngestionSettlements(settlements);
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

  const settlements = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        context(() => {
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

          const logger = createSourceIngestionLogger();
          return runSourceIngestionUnit({
            classifyFailure: (error) =>
              classifySourceIngestionFailure(
                error,
                { isNotFoundError, resolveErrorCode: resolveIngestionErrorCode },
              ),
            executeIngest: async () => {
              if (!source.url) {
                return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
              }

              const fetcher = createIcsSourceFetcher({
                calendarId: source.calendarId,
                database,
                safeFetchOptions,
                url: source.url,
              });

              const ingestEvents: Record<string, unknown>[] = [];
              const ingestResult = await ingestSource({
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
              });
              return {
                eventsAdded: ingestResult.eventsAdded,
                eventsRemoved: ingestResult.eventsRemoved,
                ingestEvents,
              };
            },
            logger,
            metadata: {
              calendarId: source.calendarId,
              provider: "ical",
              userId: source.userId,
            },
            runtime: sourceRuntime,
          });
        }),
      SOURCE_TIMEOUT_MS),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );
  return summarizeIngestionSettlements(settlements);
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
