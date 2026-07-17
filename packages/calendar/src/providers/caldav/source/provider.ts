import {
  buildSourceEventStateIdsToRemove,
  buildSourceEventsToAdd,
} from "../../../core/source/event-diff";
import {
  buildInvalidStoredEventIdsToRemove,
  parseStoredSourceEventStatesRecoveringInvalid,
} from "../../../core/source/stored-event-state";
import {
  buildEventStateInsertRow,
  insertEventStatesWithConflictResolution,
} from "../../../core/source/write-event-states";
import { isKeeperEvent } from "../../../core/events/identity";
import type { SourceEvent } from "../../../core/types";
import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CalDAVClient } from "../shared/client";
import { resolveAuthMethod } from "../shared/digest-fetch";
import { parseICalCalendarsToRemoteEvents } from "../shared/ics";
import { isCalDAVAuthenticationError } from "./auth-error-classification";
import { createCalDAVSourceService } from "./sync";
import { getCalDAVSyncWindow } from "./sync-window";
import type {
  CalDAVProviderOptions,
  CalDAVSourceAccount,
  CalDAVSourceProviderConfig,
  CalDAVSourceSyncResult,
} from "../types";
import { withSourceIngestLock } from "../../../core/source/ingest-lock";

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
    const parsedEvents = parseICalCalendarsToRemoteEvents(
      objects.flatMap(({ data }) => {
        if (!data) {
          return [];
        }
        return [data];
      }),
    );

    for (const parsed of parsedEvents) {
      if (isKeeperEvent(parsed.uid)) {
        continue;
      }

      if (!parsed.recurrenceRule && parsed.endTime < syncWindow.start) {
        continue;
      }

      events.push({
        availability: parsed.availability,
        description: parsed.description,
        endTime: parsed.endTime,
        exceptionDates: parsed.exceptionDates,
        recurrenceId: parsed.recurrenceId,
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
    const storedEvents = await database
      .select({
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
    const parseResult = parseStoredSourceEventStatesRecoveringInvalid(storedEvents);
    const existingEvents = parseResult.events;

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, events, { isDeltaSync: false });
    const eventStateIdsToRemove = [...new Set([
      ...buildInvalidStoredEventIdsToRemove(parseResult.failures, events),
      ...buildSourceEventStateIdsToRemove(existingEvents, events),
    ])];

    if (
      eventStateIdsToRemove.length > EMPTY_COUNT
      || eventsToAdd.length > EMPTY_COUNT
    ) {
      await database.transaction(async (transaction) => {
        if (eventStateIdsToRemove.length > EMPTY_COUNT) {
          await transaction
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
            transaction,
            eventsToAdd.map((event) => buildEventStateInsertRow(calendarId, event)),
          );
        }
      });
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
      return await withSourceIngestLock(database, account.calendarId, async () => {
        await refreshOriginalName(account);
        const events = await fetchEventsFromCalDAV(account);
        return processEvents(account.calendarId, events);
      });
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
