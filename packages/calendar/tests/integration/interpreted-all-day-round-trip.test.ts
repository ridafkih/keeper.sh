import { describe, expect, it } from "vitest";
import {
  buildEventStateInsertRow,
  generateDeterministicEventUid,
  ingestSource,
  materializeRecurrenceEvents,
  parseStoredSourceEventStates,
  resolveIsAllDayEvent,
  syncCalendar,
} from "../../src/index";
import type {
  CalendarSyncProvider,
  EventMapping,
  IngestionChanges,
  MaterializedSyncableEvent,
  PendingChanges,
  RemoteEvent,
  SourceEvent,
  StoredSourceEventState,
} from "../../src/index";
import { interpretFullDayTimedEventsAsAllDay } from "../../src/ics/utils/interpret-full-day-timed-events";
import { serializeOutlookEvent } from "../../src/providers/outlook/destination/serialize-event";
import { parseEventTime as parseOutlookEventTime } from "../../src/providers/outlook/shared/date-time";
import { serializeGoogleEvent } from "../../src/providers/google/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../src/providers/google/shared/date-time";
import { eventToICalString, parseICalToRemoteEvent } from "../../src/providers/caldav/shared/ics";
import { createEditableEventContentHash } from "../../src/core/events/content-hash";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const MATERIALIZATION_WINDOW = {
  end: new Date("2027-01-01T00:00:00.000Z"),
  start: new Date("2026-01-01T00:00:00.000Z"),
};
const RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const requireValue = <TValue>(value: TValue | null | undefined): TValue => {
  if (value === null || value === globalThis.undefined) {
    throw new Error("Expected round-trip value to exist");
  }
  return value;
};

interface RemoteTimes {
  endTime: Date;
  isAllDay: boolean;
  startTime: Date;
}

/*
 * Each codec is the destination's real write path followed by its real read path.
 * A provider echoing back what Keeper wrote is exactly what reconciliation compares
 * against, so a serializer that cannot read its own output shows up here as drift.
 */
type DestinationCodec = (event: MaterializedSyncableEvent, uid: string) => RemoteTimes;

const roundTripThroughOutlook: DestinationCodec = (event) => {
  const payload = serializeOutlookEvent(event);
  return {
    endTime: requireValue(parseOutlookEventTime(payload.end, payload.isAllDay)),
    isAllDay: payload.isAllDay ?? false,
    startTime: requireValue(parseOutlookEventTime(payload.start, payload.isAllDay)),
  };
};

const roundTripThroughGoogle: DestinationCodec = (event, uid) => {
  const payload = requireValue(serializeGoogleEvent(event, uid));
  return {
    endTime: requireValue(parseGoogleEventTime(payload.end)),
    isAllDay: Boolean(payload.start?.date),
    startTime: requireValue(parseGoogleEventTime(payload.start)),
  };
};

const roundTripThroughCalDAV: DestinationCodec = (event, uid) => {
  const parsed = requireValue(parseICalToRemoteEvent(eventToICalString(event, uid)));
  return {
    endTime: parsed.endTime,
    isAllDay: parsed.isAllDay ?? false,
    startTime: parsed.startTime,
  };
};

const DESTINATION_CODECS: [string, DestinationCodec][] = [
  ["outlook", roundTripThroughOutlook],
  ["google", roundTripThroughGoogle],
  ["caldav", roundTripThroughCalDAV],
];

const toStoredRow = (id: string, event: SourceEvent): StoredSourceEventState => {
  const row = buildEventStateInsertRow(SOURCE_CALENDAR_ID, event);
  return {
    availability: row.availability ?? null,
    description: row.description ?? null,
    endTime: row.endTime,
    exceptionDates: row.exceptionDates ?? null,
    id,
    isAllDay: row.isAllDay ?? null,
    location: row.location ?? null,
    recurrenceId: row.recurrenceId ?? null,
    recurrenceRule: row.recurrenceRule ?? null,
    sourceEventId: row.sourceEventId ?? null,
    sourceEventType: row.sourceEventType ?? null,
    sourceEventUid: row.sourceEventUid ?? null,
    startTime: row.startTime,
    startTimeZone: row.startTimeZone ?? null,
    title: row.title ?? null,
  };
};

class InMemoryEventStateStore {
  private nextId = 1;
  public readonly rows = new Map<string, StoredSourceEventState>();

  public read = (): Promise<StoredSourceEventState[]> =>
    Promise.resolve([...this.rows.values()]);

  public flush = (changes: IngestionChanges): Promise<void> => {
    for (const id of changes.deletes) {
      this.rows.delete(id);
    }
    for (const event of changes.inserts) {
      const id = `event-state-${this.nextId++}`;
      this.rows.set(id, toStoredRow(id, event));
    }
    return Promise.resolve();
  };

  public syncableEvents = (): MaterializedSyncableEvent[] =>
    materializeRecurrenceEvents(
      parseStoredSourceEventStates([...this.rows.values()]).map((row) => ({
        calendarId: SOURCE_CALENDAR_ID,
        calendarName: "Source calendar",
        calendarUrl: null,
        endTime: row.endTime,
        id: row.id,
        sourceEventUid: row.sourceEventUid ?? "",
        startTime: row.startTime,
        summary: row.title ?? "",
        ...(row.availability === "busy" && { availability: row.availability }),
        ...(row.description && { description: row.description }),
        ...(row.isAllDay !== null && { isAllDay: row.isAllDay }),
        ...(row.location && { location: row.location }),
        ...(row.recurrenceId && { recurrenceId: row.recurrenceId }),
        ...(row.recurrenceRule && { recurrenceRule: row.recurrenceRule }),
        ...(row.startTimeZone && { startTimeZone: row.startTimeZone }),
      })),
      MATERIALIZATION_WINDOW,
    );
}

class RoundTrippingDestinationProvider implements CalendarSyncProvider {
  private nextRemoteId = 1;
  private readonly codec: DestinationCodec;
  public readonly remoteEvents = new Map<string, RemoteTimes & { contentHash: string }>();
  public readonly writes = { deletes: 0, pushes: 0 };

  public constructor(codec: DestinationCodec) {
    this.codec = codec;
  }

  public deleteEvents = (eventIds: string[]) => {
    this.writes.deletes += eventIds.length;
    for (const id of eventIds) {
      this.remoteEvents.delete(id);
    }
    return Promise.resolve(eventIds.map(() => ({ success: true })));
  };

  public listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(
    [...this.remoteEvents.entries()].map(([uid, stored]) => ({
      deleteId: uid,
      editableAvailability: "busy" as const,
      editableContentHash: stored.contentHash,
      endTime: stored.endTime,
      isKeeperEvent: true,
      startTime: stored.startTime,
      supportedAvailabilities: ["busy", "free"] as const,
      uid,
    })),
  );

  public pushEvents = (events: MaterializedSyncableEvent[]) => {
    this.writes.pushes += events.length;
    return Promise.resolve(events.map((event) => {
      const remoteId = `remote-${this.nextRemoteId++}`;
      const uid = generateDeterministicEventUid(`${event.calendarId}:${event.id}`);
      const times = this.codec(event, uid);
      this.remoteEvents.set(remoteId, {
        ...times,
        contentHash: createEditableEventContentHash({
          description: event.description,
          endTime: times.endTime,
          isAllDay: times.isAllDay,
          location: event.location,
          summary: event.summary,
        }),
      });
      return { deleteId: remoteId, remoteId, success: true };
    }));
  };

  public resetWrites = (): void => {
    this.writes.deletes = 0;
    this.writes.pushes = 0;
  };
}

class InMemoryMappingStore {
  private nextId = 1;
  public readonly mappings = new Map<string, EventMapping>();

  public flush = (changes: PendingChanges): Promise<void> => {
    for (const id of changes.deletes) {
      this.mappings.delete(id);
    }
    for (const insert of changes.inserts) {
      const mapping: EventMapping = { ...insert, id: `mapping-${this.nextId++}` };
      this.mappings.set(mapping.id, mapping);
    }
    for (const update of changes.updates ?? []) {
      const mapping = this.mappings.get(update.id);
      if (mapping) {
        this.mappings.set(update.id, { ...mapping, ...update });
      }
    }
    return Promise.resolve();
  };
}

const ingestInterpreted = async (
  store: InMemoryEventStateStore,
  event: SourceEvent,
  calendarTimeZone: string,
): Promise<void> => {
  await ingestSource({
    calendarId: SOURCE_CALENDAR_ID,
    fetchEvents: () => Promise.resolve({
      events: interpretFullDayTimedEventsAsAllDay([event], {
        calendarTimeZone,
        enabled: true,
      }),
      syncWindow: RECONCILIATION_SCOPE.authoritativeWindow,
    }),
    flush: store.flush,
    readExistingEvents: store.read,
  });
};

const materializeInterpreted = async (
  event: SourceEvent,
  calendarTimeZone: string,
): Promise<MaterializedSyncableEvent[]> => {
  const store = new InMemoryEventStateStore();
  await ingestInterpreted(store, event, calendarTimeZone);
  return store.syncableEvents().toSorted(
    (first, second) => first.startTime.getTime() - second.startTime.getTime(),
  );
};

const NEW_YORK_DAILY_SERIES: SourceEvent = {
  endTime: new Date("2026-03-06T05:00:00.000Z"),
  recurrenceRule: { count: 8, frequency: "DAILY" },
  startTime: new Date("2026-03-05T05:00:00.000Z"),
  startTimeZone: "America/New_York",
  title: "Interpreted all-day series",
  uid: "new-york-series",
};

const BERLIN_SINGLE_DAY: SourceEvent = {
  endTime: new Date("2026-03-05T23:00:00.000Z"),
  startTime: new Date("2026-03-04T23:00:00.000Z"),
  startTimeZone: "Europe/Berlin",
  title: "Interpreted all-day day",
  uid: "berlin-single",
};

const PLAIN_ALL_DAY: SourceEvent = {
  endTime: new Date("2026-03-06T00:00:00.000Z"),
  isAllDay: true,
  startTime: new Date("2026-03-05T00:00:00.000Z"),
  title: "Plain VALUE=DATE all-day",
  uid: "plain-all-day",
};

describe("interpreted all-day normalization", () => {
  it("anchors a zone behind UTC on UTC midnight across a DST transition", async () => {
    const occurrences = await materializeInterpreted(
      NEW_YORK_DAILY_SERIES,
      "America/New_York",
    );

    expect(occurrences).toHaveLength(8);
    expect(occurrences.map((occurrence) => occurrence.startTime.toISOString())).toEqual([
      "2026-03-05T00:00:00.000Z",
      "2026-03-06T00:00:00.000Z",
      "2026-03-07T00:00:00.000Z",
      "2026-03-08T00:00:00.000Z",
      "2026-03-09T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
      "2026-03-11T00:00:00.000Z",
      "2026-03-12T00:00:00.000Z",
    ]);
    expect(occurrences.every((occurrence) => resolveIsAllDayEvent(occurrence))).toBe(true);
  });

  it("anchors a zone ahead of UTC on the local calendar day", async () => {
    const [occurrence] = await materializeInterpreted(BERLIN_SINGLE_DAY, "Europe/Berlin");

    expect(occurrence?.startTime.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(occurrence?.endTime.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });
});

describe("interpreted all-day destination payloads", () => {
  it("writes Outlook all-day times at midnight for every occurrence", async () => {
    const occurrences = await materializeInterpreted(
      NEW_YORK_DAILY_SERIES,
      "America/New_York",
    );
    const payloads = occurrences.map((occurrence) => serializeOutlookEvent(occurrence));

    expect(payloads.every((payload) => payload.isAllDay)).toBe(true);
    expect(payloads.map((payload) => requireValue(payload.start).dateTime)).toEqual([
      "2026-03-05T00:00:00.000",
      "2026-03-06T00:00:00.000",
      "2026-03-07T00:00:00.000",
      "2026-03-08T00:00:00.000",
      "2026-03-09T00:00:00.000",
      "2026-03-10T00:00:00.000",
      "2026-03-11T00:00:00.000",
      "2026-03-12T00:00:00.000",
    ]);
  });

  it("writes the Google date for the local calendar day of a zone ahead of UTC", async () => {
    const [occurrence] = await materializeInterpreted(BERLIN_SINGLE_DAY, "Europe/Berlin");
    const payload = serializeGoogleEvent(requireValue(occurrence), "uid@keeper.sh");

    expect(payload?.start).toEqual({ date: "2026-03-05" });
    expect(payload?.end).toEqual({ date: "2026-03-06" });
  });

  it("writes the CalDAV DATE value for the local calendar day of a zone ahead of UTC", async () => {
    const [occurrence] = await materializeInterpreted(BERLIN_SINGLE_DAY, "Europe/Berlin");
    const ics = eventToICalString(requireValue(occurrence), "uid@keeper.sh");

    expect(ics).toContain("DTSTART;VALUE=DATE:20260305");
    expect(ics).toContain("DTEND;VALUE=DATE:20260306");
  });
});

describe("stored rows written under the local-midnight behaviour", () => {
  it("are replaced by the next ingest and converge on the run after", async () => {
    const eventStates = new InMemoryEventStateStore();
    const mappings = new InMemoryMappingStore();
    const provider = new RoundTrippingDestinationProvider(roundTripThroughOutlook);
    const runSync = () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: mappings.flush,
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings.mappings.values()],
        localEvents: eventStates.syncableEvents(),
        remoteEvents: await provider.listRemoteEvents(),
      }),
      reconciliationScope: RECONCILIATION_SCOPE,
      userId: "user-1",
    });

    await ingestInterpreted(
      eventStates,
      { ...BERLIN_SINGLE_DAY, isAllDay: true },
      "Europe/Berlin",
    );
    expect([...eventStates.rows.values()][0]?.startTime.toISOString())
      .toBe("2026-03-04T23:00:00.000Z");
    await runSync();

    await ingestInterpreted(eventStates, BERLIN_SINGLE_DAY, "Europe/Berlin");
    expect(eventStates.rows).toHaveLength(1);
    expect([...eventStates.rows.values()][0]?.startTime.toISOString())
      .toBe("2026-03-05T00:00:00.000Z");
    expect([...eventStates.rows.values()][0]?.startTimeZone).toBeNull();

    await expect(runSync()).resolves.toMatchObject({ added: 1, removed: 1 });
    provider.resetWrites();
    await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
    expect(provider.writes).toEqual({ deletes: 0, pushes: 0 });
  });
});

describe.each(DESTINATION_CODECS)("%s round trip", (_name, codec) => {
  it.each([
    ["a zone behind UTC crossing DST", NEW_YORK_DAILY_SERIES, "America/New_York", 8],
    ["a zone ahead of UTC", BERLIN_SINGLE_DAY, "Europe/Berlin", 1],
  ])("reads back what it wrote for %s", async (_label, sourceEvent, timeZone, count) => {
    const occurrences = await materializeInterpreted(sourceEvent, timeZone);
    expect(occurrences).toHaveLength(count);

    for (const occurrence of occurrences) {
      const times = codec(occurrence, "uid@keeper.sh");
      expect(times.isAllDay).toBe(true);
      expect(times.startTime.toISOString()).toBe(occurrence.startTime.toISOString());
      expect(times.endTime.toISOString()).toBe(occurrence.endTime.toISOString());
    }
  });

  it.each([
    ["an interpreted series", NEW_YORK_DAILY_SERIES, "America/New_York", 8],
    ["an interpreted single day", BERLIN_SINGLE_DAY, "Europe/Berlin", 1],
    ["a plain VALUE=DATE all-day event", PLAIN_ALL_DAY, "America/New_York", 1],
  ])("converges to zero remote writes on the second sync of %s", async (
    _label,
    sourceEvent,
    timeZone,
    count,
  ) => {
    const eventStates = new InMemoryEventStateStore();
    const mappings = new InMemoryMappingStore();
    const provider = new RoundTrippingDestinationProvider(codec);
    await ingestInterpreted(eventStates, sourceEvent, timeZone);

    const runSync = () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: mappings.flush,
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings.mappings.values()],
        localEvents: eventStates.syncableEvents(),
        remoteEvents: await provider.listRemoteEvents(),
      }),
      reconciliationScope: RECONCILIATION_SCOPE,
      userId: "user-1",
    });

    await expect(runSync()).resolves.toMatchObject({ added: count, removed: 0 });
    provider.resetWrites();

    await expect(runSync()).resolves.toMatchObject({ added: 0, removed: 0 });
    expect(provider.writes).toEqual({ deletes: 0, pushes: 0 });
    expect(provider.remoteEvents).toHaveLength(count);
  });
});
