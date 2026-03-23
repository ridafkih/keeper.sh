import { buildSourceEventStateIdsToRemove, buildSourceEventsToAdd } from "../../../core/source/event-diff";
import { insertEventStatesWithConflictResolution } from "../../../core/source/write-event-states";
import { isKeeperEvent } from "../../../core/events/identity";
import type { SourceEvent } from "../../../core/types";
import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CalDAVClient } from "../shared/client";
import { resolveAuthMethod } from "../shared/digest-fetch";
import { parseICalToRemoteEvent } from "../shared/ics";
import { isCalDAVAuthenticationError } from "./auth-error-classification";
import { createCalDAVSourceService } from "./sync";
import { getCalDAVSyncWindow } from "./sync-window";
import type {
  CalDAVProviderOptions,
  CalDAVSourceAccount,
  CalDAVSourceProviderConfig,
  CalDAVSourceSyncResult,
} from "../types";

const stringifyIfPresent = (value: unknown) => {
  if (!value) {
    return;
  }
  return JSON.stringify(value);
};

const EMPTY_COUNT = 0;
const YEARS_UNTIL_FUTURE = 2;

const DEFAULT_CALDAV_OPTIONS: CalDAVProviderOptions = {
  providerId: "caldav",
  providerName: "CalDAV",
};

interface CalDAVSourceProvider {
  syncAllSources: () => Promise<CalDAVSourceSyncResult>;
  syncSource: (sourceId: string) => Promise<CalDAVSourceSyncResult>;
  syncSourcesForUser: (userId: string) => Promise<CalDAVSourceSyncResult>;
}

const createCalDAVSourceProvider = (
  config: CalDAVSourceProviderConfig,
  options: CalDAVProviderOptions = DEFAULT_CALDAV_OPTIONS,
): CalDAVSourceProvider => {
  const { database } = config;
  const sourceService = createCalDAVSourceService(config);

  const fetchEventsFromCalDAV = async (account: CalDAVSourceAccount): Promise<SourceEvent[]> => {
    const password = sourceService.getDecryptedPassword(account.encryptedPassword);
    const client = new CalDAVClient({
      authMethod: resolveAuthMethod(account.authMethod),
      credentials: {
        password,
        username: account.username,
      },
      serverUrl: account.serverUrl,
    });

    const syncWindow = getCalDAVSyncWindow(YEARS_UNTIL_FUTURE);

    const calendarUrl = await client.resolveCalendarUrl(account.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: syncWindow.end.toISOString(),
        start: syncWindow.start.toISOString(),
      },
    });

    const events: SourceEvent[] = [];

    for (const { data } of objects) {
      if (!data) {
        continue;
      }

      const parsed = parseICalToRemoteEvent(data);

      if (!parsed) {
        continue;
      }

      if (isKeeperEvent(parsed.uid)) {
        continue;
      }

      if (parsed.endTime < syncWindow.start) {
        continue;
      }

      events.push({
        availability: parsed.availability,
        description: parsed.description,
        endTime: parsed.endTime,
        exceptionDates: parsed.exceptionDates,
        isAllDay: parsed.isAllDay,
        location: parsed.location,
        recurrenceRule: parsed.recurrenceRule,
        startTime: parsed.startTime,
        startTimeZone: parsed.startTimeZone,
        title: parsed.title,
        uid: parsed.uid,
      });
    }

    return events;
  };

  const processEvents = async (
    calendarId: string,
    events: SourceEvent[],
  ): Promise<CalDAVSourceSyncResult> => {
    const existingEvents = await database
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

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, events, { isDeltaSync: false });
    const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(existingEvents, events);

    if (eventStateIdsToRemove.length > EMPTY_COUNT) {
      await database
        .delete(eventStatesTable)
        .where(
          and(
            eq(eventStatesTable.calendarId, calendarId),
            inArray(eventStatesTable.id, eventStateIdsToRemove),
          ),
        );
    }

    if (eventsToAdd.length > EMPTY_COUNT) {
      await insertEventStatesWithConflictResolution(
        database,
        eventsToAdd.map((event) => ({
          availability: event.availability,
          calendarId,
          description: event.description,
          endTime: event.endTime,
          exceptionDates: stringifyIfPresent(event.exceptionDates),
          isAllDay: event.isAllDay,
          location: event.location,
          recurrenceRule: stringifyIfPresent(event.recurrenceRule),
          sourceEventType: event.sourceEventType ?? "default",
          sourceEventUid: event.uid,
          startTime: event.startTime,
          startTimeZone: event.startTimeZone,
          title: event.title,
        })),
      );
    }

    return {
      eventsAdded: eventsToAdd.length,
      eventsRemoved: eventStateIdsToRemove.length,
      syncToken: null,
    };
  };

  const refreshOriginalName = async (account: CalDAVSourceAccount): Promise<void> => {
    if (account.originalName !== null) {
      return;
    }

    const password = sourceService.getDecryptedPassword(account.encryptedPassword);
    const client = new CalDAVClient({
      authMethod: resolveAuthMethod(account.authMethod),
      credentials: { password, username: account.username },
      serverUrl: account.serverUrl,
    });

    const displayName = await client.fetchCalendarDisplayName(account.calendarUrl);

    if (!displayName) {
      return;
    }

    await database
      .update(calendarsTable)
      .set({ originalName: displayName })
      .where(eq(calendarsTable.id, account.calendarId));
  };

  const syncSingleSource = async (
    account: CalDAVSourceAccount,
  ): Promise<CalDAVSourceSyncResult> => {
    try {
      await refreshOriginalName(account);
      const events = await fetchEventsFromCalDAV(account);
      return processEvents(account.calendarId, events);
    } catch (error) {
      if (isCalDAVAuthenticationError(error)) {
        await database
          .update(calendarAccountsTable)
          .set({ needsReauthentication: true })
          .where(eq(calendarAccountsTable.id, account.calendarAccountId));
      }

      return {
        eventsAdded: EMPTY_COUNT,
        eventsRemoved: EMPTY_COUNT,
        syncToken: null,
      };
    }
  };

  const getSourcesToSync = (): Promise<CalDAVSourceAccount[]> => {
    if (options.providerId === "caldav") {
      return sourceService.getAllCalDAVSources();
    }
    return sourceService.getCalDAVSourcesByProvider(options.providerId);
  };

  const combineResults = (results: CalDAVSourceSyncResult[]): CalDAVSourceSyncResult => {
    let eventsAdded = EMPTY_COUNT;
    let eventsRemoved = EMPTY_COUNT;
    for (const result of results) {
      eventsAdded += result.eventsAdded;
      eventsRemoved += result.eventsRemoved;
    }
    return { eventsAdded, eventsRemoved, syncToken: null };
  };

  const syncAllSources = async (): Promise<CalDAVSourceSyncResult> => {
    const sources = await getSourcesToSync();
    const results = await Promise.all(sources.map((source) => syncSingleSource(source)));
    return combineResults(results);
  };

  const syncSource = async (calendarId: string): Promise<CalDAVSourceSyncResult> => {
    const sources = await sourceService.getAllCalDAVSources();
    const source = sources.find(({ calendarId: sourceCalendarId }) => sourceCalendarId === calendarId);

    if (!source) {
      return { eventsAdded: EMPTY_COUNT, eventsRemoved: EMPTY_COUNT, syncToken: null };
    }

    return syncSingleSource(source);
  };

  const filterSourcesByProvider = (sources: CalDAVSourceAccount[]): CalDAVSourceAccount[] => {
    if (options.providerId === "caldav") {
      return sources;
    }
    return sources.filter((source) => source.provider === options.providerId);
  };

  const syncSourcesForUser = async (userId: string): Promise<CalDAVSourceSyncResult> => {
    const sources = await sourceService.getCalDAVSourcesForUser(userId);
    const filteredSources = filterSourcesByProvider(sources);
    const results = await Promise.all(filteredSources.map((source) => syncSingleSource(source)));
    return combineResults(results);
  };

  return {
    syncAllSources,
    syncSource,
    syncSourcesForUser,
  };
};

export { createCalDAVSourceProvider };
export type { CalDAVSourceProvider };
