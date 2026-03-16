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
import { database, refreshLockRedis } from "@/context";
import env from "@/env";

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
      withTimeout(async (): Promise<IngestionSourceResult> => {
        if (!source.externalCalendarId) {
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
          return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
        }

        const fetcher = resolvedFetcher;
        const ingestEvents: Record<string, unknown>[] = [];

        try {
          const result = await ingestSource({
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

          return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
        } catch (error) {
          if (error instanceof Error && "status" in error && error.status === 404) {
            await database
              .update(calendarsTable)
              .set({ disabled: true })
              .where(eq(calendarsTable.id, source.calendarId));

            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents };
          }

          const isAuthError = error instanceof Error && (
            ("authRequired" in error && error.authRequired === true)
            || ("oauthReauthRequired" in error && error.oauthReauthRequired === true)
          );

          if (isAuthError) {
            await database
              .update(calendarAccountsTable)
              .set({ needsReauthentication: true })
              .where(eq(calendarAccountsTable.id, source.accountId));

            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents };
          }
          throw error;
        }
      }, SOURCE_TIMEOUT_MS),
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
      withTimeout(async (): Promise<IngestionSourceResult> => {
        const password = decryptPassword(source.encryptedPassword, encryptionKey);

        const fetcher = createCalDAVSourceFetcher({
          calendarUrl: source.calendarUrl ?? source.serverUrl,
          serverUrl: source.serverUrl,
          username: source.username,
          password,
        });

        const ingestEvents: Record<string, unknown>[] = [];

        try {
          const result = await ingestSource({
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

          return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
        } catch (error) {
          if (isCalDAVAuthenticationError(error)) {
            await database
              .update(calendarAccountsTable)
              .set({ needsReauthentication: true })
              .where(eq(calendarAccountsTable.id, source.accountId));

            return { eventsAdded: 0, eventsRemoved: 0, ingestEvents };
          }

          if (error instanceof Error && error.message.includes("404")) {
            await database
              .update(calendarsTable)
              .set({ disabled: true })
              .where(eq(calendarsTable.id, source.calendarId));
          }
          throw error;
        }
      }, SOURCE_TIMEOUT_MS),
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
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.calendarType, "ical"));

  let added = 0;
  let removed = 0;
  let errors = 0;
  const allIngestEvents: Record<string, unknown>[] = [];

  const settlements = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withTimeout(async (): Promise<IngestionSourceResult> => {
        if (!source.url) {
          return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
        }

        const fetcher = createIcsSourceFetcher({
          calendarId: source.calendarId,
          url: source.url,
          database,
        });

        const ingestEvents: Record<string, unknown>[] = [];

        const result = await ingestSource({
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

        return { eventsAdded: result.eventsAdded, eventsRemoved: result.eventsRemoved, ingestEvents };
      }, SOURCE_TIMEOUT_MS),
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
