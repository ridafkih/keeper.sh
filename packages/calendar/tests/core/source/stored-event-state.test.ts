import { describe, expect, it } from "vitest";
import { buildSourceEventsToAdd } from "../../../src/core/source/event-diff";
import { parseStoredSourceEventState } from "../../../src/core/source/stored-event-state";

const createStoredEvent = () => ({
  endTime: new Date("2026-03-12T11:00:00.000Z"),
  exceptionDates: '[{"date":"2026-03-19T10:00:00.000Z"}]',
  id: "event-state-1",
  recurrenceId: null,
  recurrenceRule: '{"frequency":"WEEKLY","interval":1}',
  sourceEventInstanceKey: "slot|uid-1|2026-03-12T10:00:00.000Z|2026-03-12T11:00:00.000Z",
  sourceEventUid: "uid-1",
  startTime: new Date("2026-03-12T10:00:00.000Z"),
  startTimeZone: null,
});

describe("parseStoredSourceEventState", () => {
  it("converts a database row into the recurrence domain shape", () => {
    const event = parseStoredSourceEventState(createStoredEvent());

    expect(event.recurrenceRule).toEqual({ frequency: "WEEKLY", interval: 1 });
    expect(event.exceptionDates?.[0]?.date).toBeInstanceOf(Date);
  });

  it("fails before diffing when persisted recurrence data is corrupt", () => {
    expect(() => parseStoredSourceEventState({
      ...createStoredEvent(),
      recurrenceRule: "not-json",
    })).toThrow("Failed to JSON.parse recurrenceRule for event event-state-1");
  });

  it("compares parsed storage and incoming recurrence values in one domain shape", () => {
    const existingEvent = parseStoredSourceEventState({
      ...createStoredEvent(),
      recurrenceRule: JSON.stringify({
        frequency: "WEEKLY",
        until: { date: "2026-12-31T00:00:00.000Z" },
      }),
    });

    const eventsToAdd = buildSourceEventsToAdd([existingEvent], [{
      endTime: existingEvent.endTime,
      exceptionDates: [{ date: new Date("2026-03-19T10:00:00.000Z") }],
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: new Date("2026-12-31T00:00:00.000Z") },
      },
      startTime: existingEvent.startTime,
      uid: "uid-1",
    }]);

    expect(eventsToAdd).toEqual([]);
  });
});
