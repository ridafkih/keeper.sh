import { describe, expect, it } from "vitest";
import type {
  EventMapping,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "@keeper.sh/calendar";
import { readDestinationRemoteEvents } from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-09-01T00:00:00.000Z"),
  timeMin: new Date("2026-08-01T00:00:00.000Z"),
};

const IN_WINDOW_MAPPING_COUNT = 800;
const HISTORICAL_MAPPING_COUNT = 3000;
const VERIFICATION_BUDGET = 200;

const createInWindowStart = (index: number): Date =>
  new Date(REQUESTED_WINDOW.timeMin.getTime() + (index % 27 + 1) * 60 * 60 * 1000);

const createHistoricalStart = (index: number): Date =>
  new Date(Date.UTC(2019, 0, 1) + index * 60 * 60 * 1000);

const withHalfHour = (start: Date): Date => new Date(start.getTime() + 30 * 60 * 1000);

const createLocalEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: withHalfHour(createInWindowStart(index)),
  eventStateId: `event-state-${index}`,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: createInWindowStart(index),
  summary: `Event ${index}`,
});

const createInWindowMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `in-window-event-${index}`,
  destinationEventUid: `in-window-uid-${index}`,
  endTime: withHalfHour(createInWindowStart(index)),
  eventStateId: `event-state-${index}`,
  id: `in-window-mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createInWindowStart(index),
  syncEventHash: "hash-recorded-at-last-push",
  syncEventId: `sync-event-${index}`,
});

const createHistoricalMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `historical-event-${index}`,
  destinationEventUid: `historical-uid-${index}`,
  endTime: withHalfHour(createHistoricalStart(index)),
  eventStateId: `historical-event-state-${index}`,
  id: `historical-mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createHistoricalStart(index),
  syncEventHash: "hash-recorded-at-last-push",
  syncEventId: `historical-sync-event-${index}`,
});

const createProviderDouble = () => {
  const verifiedIds: string[] = [];
  const listedWindows: ListRemoteEventsOptions[] = [];
  return {
    getRemoteEventsByIds: (): Promise<RemoteEvent[]> => Promise.resolve([]),
    listedWindows,
    listRemoteEvents: (options: ListRemoteEventsOptions): Promise<RemoteEvent[]> => {
      listedWindows.push(options);
      return Promise.resolve([]);
    },
    verifiedIds,
    verifyEventsExist: (deleteIds: string[]): Promise<RemoteEvent[]> => {
      verifiedIds.push(...deleteIds);
      return Promise.resolve([]);
    },
  };
};

describe("verification is bounded and windowed", () => {
  const localEvents = Array.from(
    { length: IN_WINDOW_MAPPING_COUNT },
    (unused, index) => createLocalEvent(index),
  );
  const inWindowMappings = Array.from(
    { length: IN_WINDOW_MAPPING_COUNT },
    (unused, index) => createInWindowMapping(index),
  );
  const historicalMappings = Array.from(
    { length: HISTORICAL_MAPPING_COUNT },
    (unused, index) => createHistoricalMapping(index),
  );

  it("never verifies mappings the pass removes for falling outside the window", async () => {
    const provider = createProviderDouble();

    await readDestinationRemoteEvents({
      existingMappings: [...inWindowMappings, ...historicalMappings],
      localEvents,
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(provider.listedWindows).toEqual([REQUESTED_WINDOW]);
    expect(provider.verifiedIds.filter((id) => id.startsWith("historical-event-"))).toEqual([]);
  });

  it("verifies the same mappings whatever order the rows arrive in", async () => {
    const shuffled = [...inWindowMappings, ...historicalMappings].toReversed();

    const firstPass = createProviderDouble();
    await readDestinationRemoteEvents({
      existingMappings: [...inWindowMappings, ...historicalMappings],
      localEvents,
      provider: firstPass,
      requestedWindow: REQUESTED_WINDOW,
    });

    const secondPass = createProviderDouble();
    await readDestinationRemoteEvents({
      existingMappings: shuffled,
      localEvents,
      provider: secondPass,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(secondPass.verifiedIds).toEqual(firstPass.verifiedIds);
  });

  it("bounds how many mappings one pass verifies", async () => {
    const provider = createProviderDouble();

    await readDestinationRemoteEvents({
      existingMappings: [...inWindowMappings, ...historicalMappings],
      localEvents,
      provider,
      requestedWindow: REQUESTED_WINDOW,
    });

    expect(provider.verifiedIds.length).toBeGreaterThan(0);
    expect(provider.verifiedIds.length).toBeLessThanOrEqual(VERIFICATION_BUDGET);
  });
});
