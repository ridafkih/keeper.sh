import { describe, expect, it } from "vitest";
import { isEventInDestinationReconciliationWindow } from "../../../src/core/events/events";
import { overlapsTimeWindow } from "../../../src/core/events/time-range";
import { filterSourceEventsToSyncWindow } from "../../../src/core/source/sync-diagnostics";
import type { SourceEvent } from "../../../src/core/types";

const TIME_MIN = new Date("2027-04-01T00:00:00.000Z");
const TIME_MAX = new Date("2027-07-01T00:00:00.000Z");

const buildSourceEvent = (startTime: Date, endTime: Date): SourceEvent => ({
  endTime,
  startTime,
  title: "Degenerate",
  uid: "source-uid",
} as SourceEvent);

const isIngested = (startTime: Date, endTime: Date): boolean =>
  filterSourceEventsToSyncWindow(
    [buildSourceEvent(startTime, endTime)],
    { timeMax: TIME_MAX, timeMin: TIME_MIN },
  ).events.length === 1;

describe("destination reconciliation window agrees with the shared window predicate", () => {
  const cases: { name: string; startTime: Date; endTime: Date }[] = [
    {
      endTime: TIME_MIN,
      name: "zero-duration event exactly on the lower edge",
      startTime: TIME_MIN,
    },
    {
      endTime: new Date("2027-05-01T00:00:00.000Z"),
      name: "zero-duration event inside the window",
      startTime: new Date("2027-05-01T00:00:00.000Z"),
    },
    {
      endTime: new Date("2027-04-30T00:00:00.000Z"),
      name: "inverted event whose end is still inside the window",
      startTime: new Date("2027-05-01T00:00:00.000Z"),
    },
    {
      endTime: new Date("2027-01-01T00:00:00.000Z"),
      name: "inverted event whose end predates the window but whose start is inside it",
      startTime: new Date("2027-05-01T00:00:00.000Z"),
    },
    {
      endTime: new Date("2027-03-31T23:59:59.999Z"),
      name: "inverted event whose end is one millisecond before the lower edge",
      startTime: new Date("2027-04-02T00:00:00.000Z"),
    },
  ];

  for (const testCase of cases) {
    it(`reads a ${testCase.name} the same way at ingest and at the destination`, () => {
      const event = { endTime: testCase.endTime, startTime: testCase.startTime };

      const ingested = isIngested(testCase.startTime, testCase.endTime);
      const materialized = overlapsTimeWindow(event, TIME_MIN, TIME_MAX);
      const reconciled = isEventInDestinationReconciliationWindow(event, TIME_MIN);

      expect({ ingested, materialized, reconciled }).toEqual({
        ingested,
        materialized: ingested,
        reconciled: ingested,
      });
    });
  }

  it("still keeps an inverted event out of the destination read once its start leaves the window", () => {
    const event = {
      endTime: new Date("2027-01-01T00:00:00.000Z"),
      startTime: new Date("2027-02-01T00:00:00.000Z"),
    };

    expect(overlapsTimeWindow(event, TIME_MIN, TIME_MAX)).toBe(false);
    expect(isEventInDestinationReconciliationWindow(event, TIME_MIN)).toBe(false);
  });
});
