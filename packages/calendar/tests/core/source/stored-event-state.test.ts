import { describe, expect, it } from "vitest";
import { buildSourceEventsToAdd } from "../../../src/core/source/event-diff";
import {
  buildInvalidStoredEventIdsToRemove,
  parseStoredSourceEventState,
  parseStoredSourceEventStatesRecoveringInvalid,
} from "../../../src/core/source/stored-event-state";

const createStoredEvent = () => ({
  endTime: new Date("2026-03-12T11:00:00.000Z"),
  exceptionDates: '[{"date":"2026-03-19T10:00:00.000Z"}]',
  id: "event-state-1",
  recurrenceId: null,
  recurrenceRule: '{"frequency":"WEEKLY","interval":1}',
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

  it("partitions corrupt rows for full-sync recovery without hiding validation details", () => {
    const validEvent = createStoredEvent();
    const corruptEvent = {
      ...createStoredEvent(),
      id: "event-state-corrupt",
      recurrenceRule: "not-json",
    };

    const result = parseStoredSourceEventStatesRecoveringInvalid([
      validEvent,
      corruptEvent,
    ]);

    expect(result.events.map((event) => event.id)).toEqual(["event-state-1"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.eventId).toBe("event-state-corrupt");
    expect(result.failures[0]?.error.message).toBe(
      "Failed to JSON.parse recurrenceRule for event event-state-corrupt",
    );
  });

  it("repairs matching corrupt rows by upsert and deletes only absent corrupt rows", () => {
    const { failures: [matchingFailure] } = parseStoredSourceEventStatesRecoveringInvalid([{
      ...createStoredEvent(),
      id: "matching-corrupt",
      recurrenceRule: "not-json",
    }]);
    const { failures: [absentFailure] } = parseStoredSourceEventStatesRecoveringInvalid([{
      ...createStoredEvent(),
      id: "absent-corrupt",
      recurrenceRule: "not-json",
      sourceEventUid: "absent-uid",
    }]);
    if (!matchingFailure || !absentFailure) {
      throw new Error("Expected corrupt rows to fail recurrence parsing");
    }

    expect(buildInvalidStoredEventIdsToRemove(
      [matchingFailure, absentFailure],
      [{
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        recurrenceRule: { frequency: "WEEKLY" },
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        uid: "uid-1",
      }],
    )).toEqual(["absent-corrupt"]);
  });

  it("never transfers a corrupt provider row to a different provider identity", () => {
    const { failures: [failure] } = parseStoredSourceEventStatesRecoveringInvalid([{
      ...createStoredEvent(),
      recurrenceRule: "not-json",
      sourceEventId: "provider-old",
    }]);
    if (!failure) {
      throw new Error("Expected corrupt provider row to fail recurrence parsing");
    }

    expect(buildInvalidStoredEventIdsToRemove(
      [failure],
      [{
        endTime: new Date("2026-03-12T11:00:00.000Z"),
        sourceEventId: "provider-new",
        startTime: new Date("2026-03-12T10:00:00.000Z"),
        uid: "uid-1",
      }],
    )).toEqual(["event-state-1"]);
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
