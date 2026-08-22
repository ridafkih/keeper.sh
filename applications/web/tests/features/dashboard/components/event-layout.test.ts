import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../../src/hooks/use-events";
import {
  bucketEventsByDay,
  layoutDayEvents,
  MIN_EVENT_SPAN_MS,
  resolvePillRows,
  resolveVisiblePillCount,
  stackIndentPx,
  tileBox,
  timeOfDayFraction,
} from "../../../../src/features/dashboard/components/event-layout";
import type {
  DayEvents,
  PositionedEvent,
} from "../../../../src/features/dashboard/components/event-layout";

const MS_PER_DAY = 86_400_000;

const day = new Date(2026, 0, 5);
const at = (hour: number, minute = 0): Date => new Date(2026, 0, 5, hour, minute);

const timedEvent = (id: string, startTime: Date, endTime: Date): CalendarEvent => ({
  id,
  eventStateId: null,
  title: id,
  description: null,
  startTime,
  endTime,
  isAllDay: false,
  calendarId: "calendar",
  calendarName: "Calendar",
  calendarProvider: "google",
  calendarUrl: "https://calendar.example",
});

const allDayEvent = (id: string, startIso: string, endIso: string): CalendarEvent => ({
  ...timedEvent(id, new Date(startIso), new Date(endIso)),
  isAllDay: true,
});

const byId = (layout: PositionedEvent[]): Record<string, PositionedEvent> =>
  Object.fromEntries(layout.map((item) => [item.event.id, item]));

describe("layoutDayEvents geometry", () => {
  it("positions an event by its share of the day", () => {
    const [item] = layoutDayEvents([timedEvent("meeting", at(9), at(10))], day);

    expect(item.topFraction).toBeCloseTo(9 / 24);
    expect(item.heightFraction).toBeCloseTo(1 / 24);
  });

  it("clamps an event to the day at both ends", () => {
    const layout = byId(
      layoutDayEvents(
        [
          timedEvent("late", at(22), new Date(2026, 0, 6, 2)),
          timedEvent("early", new Date(2026, 0, 4, 22), at(2)),
        ],
        day,
      ),
    );

    expect(layout.late.topFraction).toBeCloseTo(22 / 24);
    expect(layout.late.heightFraction).toBeCloseTo(2 / 24);
    expect(layout.early.topFraction).toBe(0);
    expect(layout.early.heightFraction).toBeCloseTo(2 / 24);
  });

  it("floors short and zero-length events to the minimum span", () => {
    const layout = byId(
      layoutDayEvents(
        [timedEvent("brief", at(9), at(9, 5)), timedEvent("instant", at(11), at(11))],
        day,
      ),
    );
    const minimum = MIN_EVENT_SPAN_MS / MS_PER_DAY;

    expect(layout.brief.heightFraction).toBeCloseTo(minimum);
    expect(layout.instant.heightFraction).toBeCloseTo(minimum);
  });

  it("runs an event that ends at midnight to the bottom of the day", () => {
    const [item] = layoutDayEvents([timedEvent("last", at(23), new Date(2026, 0, 6, 0))], day);

    expect(item.topFraction + item.heightFraction).toBeCloseTo(1);
  });

  it("positions by the wall clock on a daylight-saving day", () => {
    // US clocks spring forward on 2026-03-08; noon must still sit halfway
    // down the day, not 11/23 of the way (passes in any zone, pins the
    // behaviour where the day is 23 hours long).
    const dstDay = new Date(2026, 2, 8);
    const [item] = layoutDayEvents(
      [timedEvent("noon", new Date(2026, 2, 8, 12), new Date(2026, 2, 8, 13))],
      dstDay,
    );

    expect(item.topFraction).toBeCloseTo(0.5);
  });
});

describe("layoutDayEvents clusters", () => {
  it("keeps sequential events in a single column", () => {
    const layout = layoutDayEvents(
      [timedEvent("first", at(9), at(10)), timedEvent("second", at(10), at(11))],
      day,
    );

    for (const item of layout) {
      expect(item.columnCount).toBe(1);
      expect(item.stackIndex).toBe(0);
      expect(item.elevation).toBe(0);
      expect(item.tiled).toBe(false);
    }
  });

  it("tiles concurrent events into side-by-side columns", () => {
    const layout = byId(
      layoutDayEvents(
        [timedEvent("first", at(9), at(10)), timedEvent("second", at(9), at(10))],
        day,
      ),
    );

    expect(layout.first.columnIndex).toBe(0);
    expect(layout.second.columnIndex).toBe(1);
    expect(layout.first.columnCount).toBe(2);
    expect(layout.first.tiled).toBe(true);
    expect(layout.second.tiled).toBe(true);
  });

  it("cascades a transitive chain and reuses a freed lane", () => {
    // a and c never overlap, but both overlap b, so all three share a cluster.
    const layout = byId(
      layoutDayEvents(
        [
          timedEvent("a", at(9), at(10, 30)),
          timedEvent("b", at(10), at(12)),
          timedEvent("c", at(11, 30), at(13)),
        ],
        day,
      ),
    );

    expect(layout.a.columnIndex).toBe(0);
    expect(layout.b.columnIndex).toBe(1);
    expect(layout.c.columnIndex).toBe(0);
    expect(layout.a.columnCount).toBe(2);
    expect([layout.a.stackIndex, layout.b.stackIndex, layout.c.stackIndex]).toEqual([0, 1, 1]);
    expect([layout.a.elevation, layout.b.elevation, layout.c.elevation]).toEqual([0, 1, 2]);
    expect(layout.a.tiled).toBe(false);
  });

  it("expands a card right across free columns", () => {
    const layout = byId(
      layoutDayEvents(
        [
          timedEvent("long", at(9), at(11)),
          timedEvent("b", at(9), at(9, 30)),
          timedEvent("c", at(9), at(9, 30)),
          timedEvent("d", at(10), at(10, 30)),
        ],
        day,
      ),
    );

    expect(layout.long.columnSpan).toBe(1);
    expect(layout.d.columnIndex).toBe(1);
    expect(layout.d.columnSpan).toBe(2);
    expect(layout.d.columnCount).toBe(3);
  });

  it("keeps the cascade for a comfortable stagger", () => {
    const layout = byId(
      layoutDayEvents(
        [timedEvent("outer", at(11), at(14)), timedEvent("inner", at(12), at(13))],
        day,
      ),
    );

    expect(layout.outer.tiled).toBe(false);
    expect(layout.inner.stackIndex).toBe(1);
    expect(layout.inner.elevation).toBe(1);
  });

  it("tiles a close stagger but not one at the threshold", () => {
    const close = byId(
      layoutDayEvents(
        [timedEvent("a", at(9), at(10)), timedEvent("b", at(9, 40), at(10, 30))],
        day,
      ),
    );
    const threshold = byId(
      layoutDayEvents(
        [timedEvent("a", at(9), at(10)), timedEvent("b", at(9, 45), at(10, 30))],
        day,
      ),
    );

    expect(close.a.tiled).toBe(true);
    expect(threshold.a.tiled).toBe(false);
  });

  it("tiles the whole cluster when any overlapping pair starts too close", () => {
    const layout = layoutDayEvents(
      [
        timedEvent("a", at(9), at(12)),
        timedEvent("b", at(10), at(12)),
        timedEvent("c", at(10, 10), at(12)),
      ],
      day,
    );

    expect(layout.every((item) => item.tiled)).toBe(true);
    expect(layout[0].columnCount).toBe(3);
  });

  it("never clusters back-to-back events", () => {
    const layout = byId(
      layoutDayEvents(
        [timedEvent("a", at(9), at(9, 30)), timedEvent("b", at(9, 30), at(10))],
        day,
      ),
    );

    expect(layout.a.columnCount).toBe(1);
    expect(layout.b.columnCount).toBe(1);
    expect(layout.b.stackIndex).toBe(0);
    expect(layout.b.tiled).toBe(false);
  });
});

describe("stackIndentPx", () => {
  it("indents fully for the first levels and thinly past the cap", () => {
    expect(stackIndentPx(0)).toBe(0);
    expect(stackIndentPx(1)).toBe(14);
    expect(stackIndentPx(3)).toBe(42);
    expect(stackIndentPx(5)).toBe(50);
  });
});

describe("tileBox", () => {
  it("fills the column for a lone event", () => {
    expect(tileBox(0, 1, 1)).toEqual({ left: 0, width: 1 });
  });

  it("splits the column into equal tiles", () => {
    expect(tileBox(0, 2, 1)).toEqual({ left: 0, width: 0.5 });
    expect(tileBox(1, 2, 1)).toEqual({ left: 0.5, width: 0.5 });
  });

  it("widens a spanning card across its columns", () => {
    expect(tileBox(0, 2, 2)).toEqual({ left: 0, width: 1 });
  });
});

describe("bucketEventsByDay", () => {
  // A Sunday-to-Sunday window, so day-of-month doubles as the day key.
  const rangeStart = new Date(2026, 0, 4);
  const rangeEnd = new Date(2026, 0, 11);

  const daysHolding = (buckets: Map<number, DayEvents>, id: string, kind: keyof DayEvents): number[] =>
    [...buckets.entries()]
      .filter(([, bucket]) => bucket[kind].some((event) => event.id === id))
      .map(([key]) => new Date(key).getDate())
      .sort((first, second) => first - second);

  it("keys a single-day event under its local midnight", () => {
    const buckets = bucketEventsByDay([timedEvent("meeting", at(9), at(10))], rangeStart, rangeEnd);

    expect([...buckets.keys()]).toEqual([new Date(2026, 0, 5).getTime()]);
    expect(buckets.get(day.getTime())?.timed.map((event) => event.id)).toEqual(["meeting"]);
    expect(buckets.get(day.getTime())?.allDay).toEqual([]);
  });

  it("spreads a multi-day event over every day it overlaps", () => {
    const buckets = bucketEventsByDay(
      [timedEvent("trip", at(22), new Date(2026, 0, 7, 2))],
      rangeStart,
      rangeEnd,
    );

    expect(daysHolding(buckets, "trip", "timed")).toEqual([5, 6, 7]);
  });

  it("keeps an event ending at midnight on the day it ends", () => {
    const buckets = bucketEventsByDay(
      [timedEvent("late", at(22), new Date(2026, 0, 6, 0))],
      rangeStart,
      rangeEnd,
    );

    expect(daysHolding(buckets, "late", "timed")).toEqual([5]);
  });

  it("lands a zero-length event on its start day", () => {
    const buckets = bucketEventsByDay([timedEvent("ping", at(9), at(9))], rangeStart, rangeEnd);

    expect(daysHolding(buckets, "ping", "timed")).toEqual([5]);
  });

  it("only visits days inside the window", () => {
    const buckets = bucketEventsByDay(
      [
        timedEvent("long", new Date(2026, 0, 3, 22), new Date(2026, 0, 12, 2)),
        timedEvent("before", new Date(2026, 0, 3, 22), new Date(2026, 0, 4, 0)),
      ],
      rangeStart,
      rangeEnd,
    );

    expect(daysHolding(buckets, "long", "timed")).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(daysHolding(buckets, "before", "timed")).toEqual([]);
  });

  it("places an all-day event on its calendar days in any zone", () => {
    const buckets = bucketEventsByDay(
      [
        allDayEvent("holiday", "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z"),
        allDayEvent("offsite", "2026-01-07T00:00:00.000Z", "2026-01-10T00:00:00.000Z"),
      ],
      rangeStart,
      rangeEnd,
    );

    expect(daysHolding(buckets, "holiday", "allDay")).toEqual([5]);
    expect(daysHolding(buckets, "offsite", "allDay")).toEqual([7, 8, 9]);
    expect(daysHolding(buckets, "holiday", "timed")).toEqual([]);
  });

  it("returns each day's lists in start order", () => {
    const buckets = bucketEventsByDay(
      [
        timedEvent("noon", at(12), at(13)),
        timedEvent("morning", at(9), at(10)),
        allDayEvent("later", "2026-01-05T00:00:00.000Z", "2026-01-07T00:00:00.000Z"),
        allDayEvent("sooner", "2026-01-04T00:00:00.000Z", "2026-01-06T00:00:00.000Z"),
      ],
      rangeStart,
      rangeEnd,
    );
    const monday = buckets.get(day.getTime());

    expect(monday?.timed.map((event) => event.id)).toEqual(["morning", "noon"]);
    expect(monday?.allDay.map((event) => event.id)).toEqual(["sooner", "later"]);
  });

  it("clamps an all-day span to the window", () => {
    const buckets = bucketEventsByDay(
      [allDayEvent("fortnight", "2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z")],
      rangeStart,
      rangeEnd,
    );

    expect(daysHolding(buckets, "fortnight", "allDay")).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("resolveVisiblePillCount", () => {
  it("shows every pill when they fit", () => {
    expect(resolveVisiblePillCount(2, 2)).toEqual({ visibleCount: 2, hiddenCount: 0 });
    expect(resolveVisiblePillCount(0, 2)).toEqual({ visibleCount: 0, hiddenCount: 0 });
  });

  it("gives the last row to the overflow count when they do not", () => {
    expect(resolveVisiblePillCount(3, 2)).toEqual({ visibleCount: 1, hiddenCount: 2 });
    expect(resolveVisiblePillCount(5, 1)).toEqual({ visibleCount: 0, hiddenCount: 5 });
  });

  it("hides everything when there is no row at all", () => {
    expect(resolveVisiblePillCount(3, 0)).toEqual({ visibleCount: 0, hiddenCount: 3 });
  });
});

describe("resolvePillRows", () => {
  it("counts whole rows, each after the first paying for its gap", () => {
    expect(resolvePillRows(0)).toBe(0);
    expect(resolvePillRows(17)).toBe(0);
    expect(resolvePillRows(18)).toBe(1);
    expect(resolvePillRows(37)).toBe(1);
    expect(resolvePillRows(38)).toBe(2);
    expect(resolvePillRows(100)).toBe(5);
  });
});

describe("timeOfDayFraction", () => {
  it("reads the wall clock", () => {
    expect(timeOfDayFraction(at(0))).toBe(0);
    expect(timeOfDayFraction(at(12))).toBe(0.5);
    expect(timeOfDayFraction(at(18, 30))).toBeCloseTo(18.5 / 24);
  });

  it("keeps noon halfway down a daylight-saving day", () => {
    expect(timeOfDayFraction(new Date(2026, 2, 8, 12))).toBe(0.5);
  });
});
