import type { CronOptions } from "cronbake";
import {
  ingestSource,
  allSettledWithConcurrency,
  insertEventStatesWithConflictResolution,
} from "@keeper.sh/calendar";
import type { IngestionChanges, IngestionFetchEventsResult } from "@keeper.sh/calendar";
import { createIcsSourceFetcher } from "@keeper.sh/calendar/ics";
import { createGoogleSourceFetcher } from "@keeper.sh/calendar/google";
import { createOutlookSourceFetcher } from "@keeper.sh/calendar/outlook";
import { createCalDAVSourceFetcher } from "@keeper.sh/calendar/caldav";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  eventStatesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { database } from "@/context";
import env from "@/env";

const SOURCE_TIMEOUT_MS = 60_000;
const SOURCE_CONCURRENCY = 5;

const serializeOptionalJson = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const withTimeout = async <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> => {
  let timer: Timer | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Source ingestion timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve().then(operation),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timer);
  });
};

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

interface OAuthFetcherParams {
  accessToken: string;
  externalCalendarId: string;
  syncToken: string | null;
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
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
      externalCalendarId: calendarsTable.externalCalendarId,
      syncToken: calendarsTable.syncToken,
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .where(arrayContains(calendarsTable.capabilities, ["pull"]));

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

        const resolvedFetcher = resolveOAuthFetcher(source.provider, {
          accessToken: source.accessToken,
          externalCalendarId: source.externalCalendarId,
          syncToken: source.syncToken,
        });

        if (!resolvedFetcher) {
          return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
        }

        const fetcher = resolvedFetcher;
        const ingestEvents: Record<string, unknown>[] = [];

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
      widelog.errorFields(settlement.reason, { prefix: "ingest.oauth" });
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
    .where(arrayContains(calendarsTable.capabilities, ["pull"]));

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
      widelog.errorFields(settlement.reason, { prefix: "ingest.caldav" });
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
      widelog.errorFields(settlement.reason, { prefix: "ingest.ics" });
    }
  }

  return { added, removed, errors, ingestEvents: allIngestEvents };
};

const extractSettledResult = <TResult>(
  settlement: PromiseSettledResult<TResult>,
  fallback: TResult,
  errorPrefix: string,
): TResult => {
  if (settlement.status === "fulfilled") {
    return settlement.value;
  }
  widelog.errorFields(settlement.reason, { prefix: errorPrefix });
  return fallback;
};

export default withCronWideEvent({
  async callback() {
    setCronEventFields({ "job.type": "ingest-sources" });

    const [oauthSettlement, caldavSettlement, icsSettlement] = await Promise.allSettled([
      ingestOAuthSources(),
      ingestCalDAVSources(),
      ingestIcsSources(),
    ]);

    const defaultResult = { added: 0, removed: 0, errors: 1, ingestEvents: [] };
    const oauth = extractSettledResult(oauthSettlement, defaultResult, "ingest.oauth");
    const caldav = extractSettledResult(caldavSettlement, defaultResult, "ingest.caldav");
    const ics = extractSettledResult(icsSettlement, defaultResult, "ingest.ics");

    const allIngestEvents = [...oauth.ingestEvents, ...caldav.ingestEvents, ...ics.ingestEvents];

    setCronEventFields({
      "oauth.events.added": oauth.added,
      "oauth.events.removed": oauth.removed,
      "oauth.errors": oauth.errors,
      "caldav.events.added": caldav.added,
      "caldav.events.removed": caldav.removed,
      "caldav.errors": caldav.errors,
      "ics.events.added": ics.added,
      "ics.events.removed": ics.removed,
      "ics.errors": ics.errors,
      "ingest_events": allIngestEvents,
    });
  },
  cron: "@every_1_minutes",
  immediate: true,
  name: "ingest-sources",
  overrunProtection: false,
}) satisfies CronOptions;
