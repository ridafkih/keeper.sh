import { describe, expect, it } from "vitest";

import {
  expandRecurringEvent,
  type RecurringEventRow,
} from "@/queries/expand-recurring-event";

const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = MINUTES_PER_HOUR * MS_PER_SECOND;
const NINETY_MINUTES_MS = 90 * MS_PER_MINUTE;
const SIXTY_MINUTES_MS = MINUTES_PER_HOUR * MS_PER_MINUTE;

const buildRow = (overrides: Partial<RecurringEventRow> = {}): RecurringEventRow => ({
  id: "master-id",
  calendarId: "calendar-id",
  startTime: new Date("2026-05-04T14:00:00.000Z"),
  endTime: new Date("2026-05-04T15:00:00.000Z"),
  recurrenceRule: null,
  exceptionDates: null,
  title: "Ops Daily",
  description: null,
  location: null,
  ...overrides,
});

const ruleJson = (rule: Record<string, unknown>): string => JSON.stringify(rule);

const exceptionDatesJson = (dates: string[]): string =>
  JSON.stringify(dates.map((date) => ({ date })));

const startsIso = (occurrences: { startTime: Date }[]): string[] =>
  occurrences.map((occurrence) => occurrence.startTime.toISOString());

const durationMs = (occurrence: { startTime: Date; endTime: Date }): number =>
  occurrence.endTime.getTime() - occurrence.startTime.getTime();

describe("expandRecurringEvent", () => {
  it("emits one occurrence per day for a DAILY rule within the window", () => {
    const row = buildRow({
      recurrenceRule: ruleJson({ frequency: "DAILY" }),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-07T23:59:59.999Z"),
    );

    expect(startsIso(occurrences)).toEqual([
      "2026-05-04T14:00:00.000Z",
      "2026-05-05T14:00:00.000Z",
      "2026-05-06T14:00:00.000Z",
      "2026-05-07T14:00:00.000Z",
    ]);
  });

  it("preserves the master duration on each occurrence", () => {
    const row = buildRow({
      startTime: new Date("2026-05-04T14:00:00.000Z"),
      endTime: new Date("2026-05-04T15:30:00.000Z"),
      recurrenceRule: ruleJson({ frequency: "DAILY" }),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-05T23:59:59.999Z"),
    );

    expect(occurrences.map((occurrence) => durationMs(occurrence))).toEqual([
      NINETY_MINUTES_MS,
      NINETY_MINUTES_MS,
    ]);
  });

  it("skips occurrences listed in EXDATE", () => {
    const row = buildRow({
      recurrenceRule: ruleJson({ frequency: "DAILY" }),
      exceptionDates: exceptionDatesJson(["2026-05-06T14:00:00.000Z"]),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-07T23:59:59.999Z"),
    );

    expect(startsIso(occurrences)).toEqual([
      "2026-05-04T14:00:00.000Z",
      "2026-05-05T14:00:00.000Z",
      "2026-05-07T14:00:00.000Z",
    ]);
  });

  it("returns occurrences inside the window when the master started before it", () => {
    const row = buildRow({
      startTime: new Date("2026-01-01T14:00:00.000Z"),
      endTime: new Date("2026-01-01T15:00:00.000Z"),
      recurrenceRule: ruleJson({ frequency: "WEEKLY" }),
    });
    const windowStart = new Date("2026-05-04T00:00:00.000Z");
    const windowEnd = new Date("2026-05-31T23:59:59.999Z");

    const occurrences = expandRecurringEvent(row, windowStart, windowEnd);

    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.startTime.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(occurrence.startTime.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
      expect(durationMs(occurrence)).toBe(SIXTY_MINUTES_MS);
    }
  });

  it("honours the rule's UNTIL terminator", () => {
    const row = buildRow({
      recurrenceRule: ruleJson({
        frequency: "DAILY",
        until: { date: "2026-05-06T23:59:59.000Z" },
      }),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-10T23:59:59.999Z"),
    );

    expect(startsIso(occurrences)).toEqual([
      "2026-05-04T14:00:00.000Z",
      "2026-05-05T14:00:00.000Z",
      "2026-05-06T14:00:00.000Z",
    ]);
  });

  it("honours the rule's COUNT terminator", () => {
    const row = buildRow({
      recurrenceRule: ruleJson({ frequency: "DAILY", count: 2 }),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-10T23:59:59.999Z"),
    );

    expect(occurrences).toHaveLength(2);
  });

  it("emits the master alone when the RRULE is missing and the master is in-window", () => {
    const row = buildRow({ recurrenceRule: null });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-04T23:59:59.999Z"),
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.id).toBe("master-id");
  });

  it("emits nothing when the RRULE is missing and the master is out of window", () => {
    const row = buildRow({ recurrenceRule: null });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-30T23:59:59.999Z"),
    );

    expect(occurrences).toEqual([]);
  });

  it("assigns synthetic ids that are stable per occurrence", () => {
    const row = buildRow({
      recurrenceRule: ruleJson({ frequency: "DAILY" }),
    });

    const occurrences = expandRecurringEvent(
      row,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-05-05T23:59:59.999Z"),
    );

    expect(occurrences[0]?.id).toBe("master-id_2026-05-04T14:00:00.000Z");
    expect(occurrences[1]?.id).toBe("master-id_2026-05-05T14:00:00.000Z");
  });
});
