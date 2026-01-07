import { isKeeperEvent } from "@keeper.sh/provider-core";
import type { SourceEvent } from "@keeper.sh/provider-core";
import { eventStatesTable } from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { WideEvent } from "@keeper.sh/log";
import { and, eq, inArray } from "drizzle-orm";
import { CalDAVClient } from "../shared/client";
import { parseICalToRemoteEvent } from "../shared/ics";
import { createCalDAVSourceService } from "./sync";
import type {
  CalDAVProviderOptions,
  CalDAVSourceAccount,
  CalDAVSourceProviderConfig,
  CalDAVSourceSyncResult,
} from "../types";

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

  const fetchEventsFromCalDAV = async (
    account: CalDAVSourceAccount,
  ): Promise<SourceEvent[]> => {
    const password = sourceService.getDecryptedPassword(account.encryptedPassword);
    const client = new CalDAVClient({
      credentials: {
        password,
        username: account.username,
      },
      serverUrl: account.serverUrl,
    });

    const today = getStartOfToday();
    const futureDate = new Date(today);
    futureDate.setFullYear(futureDate.getFullYear() + YEARS_UNTIL_FUTURE);

    const calendarUrl = await client.resolveCalendarUrl(account.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: futureDate.toISOString(),
        start: today.toISOString(),
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

      if (parsed.endTime < today) {
        continue;
      }

      events.push({
        endTime: parsed.endTime,
        startTime: parsed.startTime,
        uid: parsed.uid,
      });
    }

    return events;
  };

  const processEvents = async (
    sourceId: string,
    events: SourceEvent[],
  ): Promise<CalDAVSourceSyncResult> => {
    const existingEvents = await database
      .select({
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    const existingUids = new Set(existingEvents.map((event) => event.sourceEventUid));
    const incomingUids = new Set(events.map((event) => event.uid));

    const toAdd = events.filter((event) => !existingUids.has(event.uid));
    const toRemoveUids = existingEvents
      .filter((event) => event.sourceEventUid && !incomingUids.has(event.sourceEventUid))
      .map((event) => event.sourceEventUid)
      .filter((uid): uid is string => uid !== null);

    if (toRemoveUids.length > EMPTY_COUNT) {
      await database
        .delete(eventStatesTable)
        .where(
          and(
            eq(eventStatesTable.sourceId, sourceId),
            inArray(eventStatesTable.sourceEventUid, toRemoveUids),
          ),
        );
    }

    if (toAdd.length > EMPTY_COUNT) {
      await database.insert(eventStatesTable).values(
        toAdd.map((event) => ({
          endTime: event.endTime,
          sourceEventUid: event.uid,
          sourceId,
          startTime: event.startTime,
        })),
      );
    }

    return {
      eventsAdded: toAdd.length,
      eventsRemoved: toRemoveUids.length,
      syncToken: null,
    };
  };

  const syncSingleSource = async (account: CalDAVSourceAccount): Promise<CalDAVSourceSyncResult> => {
    try {
      const events = await fetchEventsFromCalDAV(account);
      return processEvents(account.sourceId, events);
    } catch (error) {
      WideEvent.error(error);
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

  const syncSource = async (sourceId: string): Promise<CalDAVSourceSyncResult> => {
    const sources = await sourceService.getAllCalDAVSources();
    const source = sources.find((source) => source.sourceId === sourceId);

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
