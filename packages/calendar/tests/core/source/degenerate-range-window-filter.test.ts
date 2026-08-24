import { describe, expect, it } from "vitest";
import { filterSourceEventsToSyncWindow } from "../../../src/core/source/sync-diagnostics";
import { isCalDAVEventInSyncWindow } from "../../../src/providers/caldav/source/fetch-adapter";
import type { SourceEvent } from "../../../src/core/types";

const SYNC_WINDOW = {
  timeMax: new Date("2027-06-01T00:00:00.000Z"),
  timeMin: new Date("2027-03-08T00:00:00.000Z"),
};

const createSourceEvent = (overrides: Partial<SourceEvent> = {}): SourceEvent => ({
  endTime: new Date("2027-03-09T10:00:00.000Z"),
  startTime: new Date("2027-03-09T09:00:00.000Z"),
  title: "Point in time",
  uid: "source-uid-1",
  ...overrides,
} as SourceEvent);

const uidsOf = (events: SourceEvent[]): string[] => events.map((event) => event.uid);

describe("source ingest window filtering of degenerate ranges", () => {
  it("keeps a zero-duration event that sits exactly on the window lower edge", () => {
    const { events } = filterSourceEventsToSyncWindow([createSourceEvent({
      endTime: SYNC_WINDOW.timeMin,
      startTime: SYNC_WINDOW.timeMin,
    })], SYNC_WINDOW);

    expect(uidsOf(events)).toEqual(["source-uid-1"]);
  });

  it("keeps an inverted event whose start is inside the window", () => {
    const { events } = filterSourceEventsToSyncWindow([createSourceEvent({
      endTime: new Date("2027-03-01T09:00:00.000Z"),
      startTime: new Date("2027-03-10T09:00:00.000Z"),
    })], SYNC_WINDOW);

    expect(uidsOf(events)).toEqual(["source-uid-1"]);
  });

  it("keeps a zero-duration recurring occurrence on the window lower edge", () => {
    const { events } = filterSourceEventsToSyncWindow([createSourceEvent({
      endTime: SYNC_WINDOW.timeMin,
      recurrenceRule: { count: 3, frequency: "DAILY" },
      startTime: SYNC_WINDOW.timeMin,
    })], SYNC_WINDOW);

    expect(uidsOf(events)).toEqual(["source-uid-1"]);
  });

  it("still drops a zero-duration event before the window opens", () => {
    const before = new Date(SYNC_WINDOW.timeMin.getTime() - 1);

    const { events } = filterSourceEventsToSyncWindow([createSourceEvent({
      endTime: before,
      startTime: before,
    })], SYNC_WINDOW);

    expect(events).toEqual([]);
  });

  it("keeps a caldav zero-duration event on the window lower edge", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: SYNC_WINDOW.timeMin,
      startTime: SYNC_WINDOW.timeMin,
    }, SYNC_WINDOW)).toBe(true);
  });

  it("keeps a caldav inverted event whose start is inside the window", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2027-03-01T09:00:00.000Z"),
      startTime: new Date("2027-03-10T09:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
  });
});
