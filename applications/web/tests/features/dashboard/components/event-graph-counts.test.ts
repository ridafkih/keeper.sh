import { describe, expect, it } from "vitest";
import { countEventsByDay } from "../../../../src/features/dashboard/components/event-graph-counts";
import { EVENT_GRAPH_DAYS_BEFORE, EVENT_GRAPH_TOTAL_DAYS } from "../../../../src/state/event-graph-hover";
import { runInTimeZone } from "../../../helpers/time-zone";

const slotOf = (dayOffset: number): number => dayOffset + EVENT_GRAPH_DAYS_BEFORE;

const nonZeroSlots = (counts: number[]): Record<number, number> =>
  Object.fromEntries(counts.flatMap((count, slot) => (count > 0 ? [[slot, count]] : [])));

describe.each(["America/Edmonton", "Asia/Tokyo"])("countEventsByDay in %s", (timeZone) => {
  runInTimeZone(timeZone);

  it("counts an all-day event on its own calendar date", () => {
    const today = new Date(2026, 10, 5);
    const counts = countEventsByDay([{ id: "a", startTime: "2026-11-05T00:00:00.000Z", isAllDay: true }], today);
    expect(nonZeroSlots(counts)).toEqual({ [slotOf(0)]: 1 });
  });

  it("keeps an all-day event on the first day of the window", () => {
    const today = new Date(2026, 10, 12);
    const counts = countEventsByDay([{ id: "a", startTime: "2026-11-05T00:00:00.000Z", isAllDay: true }], today);
    expect(nonZeroSlots(counts)).toEqual({ 0: 1 });
  });

  it("leaves out an all-day event on the day after the window", () => {
    const today = new Date(2026, 10, 5);
    const counts = countEventsByDay([{ id: "a", startTime: "2026-11-13T00:00:00.000Z", isAllDay: true }], today);
    expect(counts).toEqual(new Array(EVENT_GRAPH_TOTAL_DAYS).fill(0));
  });

  it("counts a timed event on the local day it starts", () => {
    const today = new Date(2026, 10, 5);
    const localNineAm = new Date(2026, 10, 5, 9).toISOString();
    const counts = countEventsByDay([{ id: "t", startTime: localNineAm, isAllDay: false }], today);
    expect(nonZeroSlots(counts)).toEqual({ [slotOf(0)]: 1 });
  });
});
