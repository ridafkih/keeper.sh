import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushEchoComparison,
  PushResult,
  RemoteEventListing,
} from "../../../src/core/types";

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id}`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const matchedDivergence = {
  allDay: false,
  description: false,
  end: false,
  lengths: {},
  location: false,
  start: false,
  summary: false,
};

const runSync = async (
  localEvents: MaterializedSyncableEvent[],
  echoes: (PushEchoComparison | undefined)[],
): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  const provider = {
    deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> =>
      Promise.resolve(eventIds.map(() => ({ success: true }))),
    listRemoteEvents: (): Promise<RemoteEventListing> => Promise.resolve({ items: [], rawItemCount: 0 }),
    pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
      Promise.resolve(events.map((event, index): PushResult => ({
        deleteId: `delete-${event.id}`,
        echo: echoes[index],
        remoteId: `remote-${event.id}`,
        success: true,
      }))),
  };

  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider,
    readState: () => Promise.resolve({
      existingMappings: [],
      localEvents,
      remoteEvents: [],
      remoteRawItemCount: 0,
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

describe("push echo attribution", () => {
  it("counts diverged echo fields on the wide event", async () => {
    const event = await runSync(
      [makeEvent("ev-1"), makeEvent("ev-2"), makeEvent("ev-3")],
      [
        {
          comparable: true,
          divergence: { ...matchedDivergence, description: true, start: true },
        },
        { comparable: true, divergence: matchedDivergence },
        { comparable: false, reason: "echo-body-missing" },
      ],
    );

    expect(event["push_echo.compared_count"]).toBe(2);
    expect(event["push_echo.uncomparable_count"]).toBe(1);
    expect(event["push_echo.changed_count"]).toBe(1);
    expect(event["push_echo.description_changed_count"]).toBe(1);
    expect(event["push_echo.start_changed_count"]).toBe(1);
    expect(event["push_echo.summary_changed_count"]).toBeUndefined();
    expect(event["push_echo.location_changed_count"]).toBeUndefined();
    expect(event["push_echo.all_day_changed_count"]).toBeUndefined();
    expect(event["push_echo.end_changed_count"]).toBeUndefined();
  });

  it("counts a successful push with no echo as uncomparable, never as a silent zero", async () => {
    const event = await runSync([makeEvent("ev-1")], []);

    expect(event["push_echo.compared_count"]).toBeUndefined();
    expect(event["push_echo.uncomparable_count"]).toBe(1);
  });

  it("emits no push echo fields when nothing was pushed", async () => {
    const event = await runSync([], []);

    expect(event["push_echo.compared_count"]).toBeUndefined();
    expect(event["push_echo.uncomparable_count"]).toBeUndefined();
    expect(event["push_echo.changed_count"]).toBeUndefined();
  });
});
