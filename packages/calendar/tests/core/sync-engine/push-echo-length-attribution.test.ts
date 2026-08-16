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
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: `Event ${id}`,
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

describe("push echo length attribution", () => {
  it("emits sent and echoed length totals for a diverged description", async () => {
    const event = await runSync([makeEvent("ev-1")], [{
      comparable: true,
      divergence: {
        ...matchedDivergence,
        description: true,
        lengths: { description: { echo: 40, sent: 120 } },
      },
    }]);

    expect(event["push_echo.description_sent_length_total"]).toBe(120);
    expect(event["push_echo.description_echo_length_total"]).toBe(40);
  });

  it("sums length totals across every diverged event in the run", async () => {
    const event = await runSync(
      [makeEvent("ev-1"), makeEvent("ev-2")],
      [
        {
          comparable: true,
          divergence: {
            ...matchedDivergence,
            description: true,
            lengths: { description: { echo: 40, sent: 120 } },
          },
        },
        {
          comparable: true,
          divergence: {
            ...matchedDivergence,
            description: true,
            lengths: { description: { echo: 5, sent: 7 } },
          },
        },
      ],
    );

    expect(event["push_echo.description_changed_count"]).toBe(2);
    expect(event["push_echo.description_sent_length_total"]).toBe(127);
    expect(event["push_echo.description_echo_length_total"]).toBe(45);
  });

  it("emits a zero total when the echo emptied the field", async () => {
    const event = await runSync([makeEvent("ev-1")], [{
      comparable: true,
      divergence: {
        ...matchedDivergence,
        description: true,
        lengths: { description: { echo: 0, sent: 120 } },
      },
    }]);

    expect(event["push_echo.description_echo_length_total"]).toBe(0);
    expect(event["push_echo.description_sent_length_total"]).toBe(120);
  });

  it("emits length totals for summary and location under their own keys", async () => {
    const event = await runSync([makeEvent("ev-1")], [{
      comparable: true,
      divergence: {
        ...matchedDivergence,
        lengths: {
          location: { echo: 3, sent: 9 },
          summary: { echo: 11, sent: 6 },
        },
        location: true,
        summary: true,
      },
    }]);

    expect(event["push_echo.summary_sent_length_total"]).toBe(6);
    expect(event["push_echo.summary_echo_length_total"]).toBe(11);
    expect(event["push_echo.location_sent_length_total"]).toBe(9);
    expect(event["push_echo.location_echo_length_total"]).toBe(3);
  });

  it("emits no length fields for fields that did not diverge", async () => {
    const event = await runSync([makeEvent("ev-1")], [{
      comparable: true,
      divergence: {
        ...matchedDivergence,
        description: true,
        lengths: { description: { echo: 40, sent: 120 } },
      },
    }]);

    expect(event["push_echo.summary_sent_length_total"]).toBeUndefined();
    expect(event["push_echo.summary_echo_length_total"]).toBeUndefined();
    expect(event["push_echo.location_sent_length_total"]).toBeUndefined();
    expect(event["push_echo.location_echo_length_total"]).toBeUndefined();
  });

  it("adds no fields at all to a clean push with no divergence", async () => {
    const clean = await runSync(
      [makeEvent("ev-1")],
      [{ comparable: true, divergence: matchedDivergence }],
    );

    const lengthKeys = Object.keys(clean).filter((key) => key.includes("_length_"));
    expect(lengthKeys).toEqual([]);
    expect(clean["push_echo.compared_count"]).toBe(1);
    expect(clean["push_echo.changed_count"]).toBeUndefined();
  });
});
