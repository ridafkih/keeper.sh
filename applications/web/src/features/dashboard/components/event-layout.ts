import type { CalendarEvent } from "@/hooks/use-events";
import { addDays, startOfDay } from "./calendar-helpers";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 86_400_000;

/** Floors the time geometry, so overlap and lane decisions see the same box the user does. */
export const MIN_EVENT_SPAN_MS = 15 * MS_PER_MINUTE;

/** Overlapping events starting within this window tile into columns instead of cascading. */
export const TILE_MAX_STAGGER_MS = 45 * MS_PER_MINUTE;

const STACK_INDENT_PX = 14;
const STACK_MAX_LEVELS = 3;
const STACK_DEEP_STEP_PX = 4;

export interface PositionedEvent {
  event: CalendarEvent;
  topFraction: number;
  heightFraction: number;
  /** Cascade indent depth; drives the horizontal indent only, not the paint order. */
  stackIndex: number;
  /** Paint order within the cluster; later starts sit on top. */
  elevation: number;
  columnIndex: number;
  columnCount: number;
  columnSpan: number;
  tiled: boolean;
}

export function stackIndentPx(stackIndex: number): number {
  const capped = Math.min(stackIndex, STACK_MAX_LEVELS);
  const overflow = Math.max(0, stackIndex - STACK_MAX_LEVELS);
  return capped * STACK_INDENT_PX + overflow * STACK_DEEP_STEP_PX;
}

export function tileBox(
  columnIndex: number,
  columnCount: number,
  columnSpan: number,
): { left: number; width: number } {
  if (columnCount <= 1) return { left: 0, width: 1 };
  return { left: columnIndex / columnCount, width: columnSpan / columnCount };
}

// Wall-clock minutes, not elapsed ms: a DST day has 23 or 25 hours.
export function timeOfDayFraction(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  return minutes / MINUTES_PER_DAY;
}

function wallClockFraction(ms: number, dayEndMs: number): number {
  if (ms >= dayEndMs) return 1;
  return timeOfDayFraction(new Date(ms));
}

interface LayoutItem {
  event: CalendarEvent;
  /** Clamped to the day and floored to `MIN_EVENT_SPAN_MS`, in ms. */
  start: number;
  end: number;
  stackIndex: number;
  elevation: number;
  columnIndex: number;
  columnCount: number;
  columnSpan: number;
  tiled: boolean;
}

const overlaps = (first: LayoutItem, second: LayoutItem): boolean =>
  first.start < second.end && second.start < first.end;

function layoutCluster(cluster: LayoutItem[]): void {
  // First-fit lanes: reuse the first lane free at the start, else open one.
  const laneEnds: number[] = [];
  for (const item of cluster) {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    item.columnIndex = lane;
  }
  const columnCount = laneEnds.length;

  // Expand each card right until the first later-lane event it overlaps.
  for (const item of cluster) {
    item.columnCount = columnCount;
    let span = columnCount - item.columnIndex;
    for (const other of cluster) {
      if (other === item || other.columnIndex <= item.columnIndex) continue;
      if (overlaps(item, other)) span = Math.min(span, other.columnIndex - item.columnIndex);
    }
    item.columnSpan = Math.max(span, 1);
  }

  // Starts within TILE_MAX_STAGGER_MS would bury the earlier card's header, so the cluster tiles.
  const tiled = cluster.some((item, index) =>
    cluster
      .slice(index + 1)
      .some(
        (other) => overlaps(item, other) && Math.abs(item.start - other.start) < TILE_MAX_STAGGER_MS,
      ),
  );
  for (const item of cluster) item.tiled = tiled;
}

export function layoutDayEvents(events: CalendarEvent[], day: Date): PositionedEvent[] {
  const dayStartMs = day.getTime();
  // The local next midnight, so a DST day keeps its 23 or 25 hours.
  const dayEndMs = addDays(day, 1).getTime();

  const items: LayoutItem[] = events
    .map((event) => {
      const start = Math.max(event.startTime.getTime(), dayStartMs);
      const end = Math.min(Math.max(event.endTime.getTime(), start + MIN_EVENT_SPAN_MS), dayEndMs);
      return {
        event,
        start,
        end,
        stackIndex: 0,
        elevation: 0,
        columnIndex: 0,
        columnCount: 1,
        columnSpan: 1,
        tiled: false,
      };
    })
    // Start ascending, then longer first, so the widest card anchors a cluster.
    .sort(
      (first, second) =>
        first.start - second.start || second.end - second.start - (first.end - first.start),
    );

  // Group transitively overlapping events into clusters; each is laid out independently.
  let cluster: LayoutItem[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    if (item.start >= clusterEnd) {
      layoutCluster(cluster);
      cluster = [];
    }
    // Indent past every earlier cluster member still running at our start.
    item.stackIndex = cluster.filter((previous) => previous.end > item.start).length;
    // Paint order: later starts sit on top of earlier ones in the cluster.
    item.elevation = cluster.length;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  layoutCluster(cluster);

  return items.map((item) => ({
    event: item.event,
    topFraction: wallClockFraction(item.start, dayEndMs),
    heightFraction: wallClockFraction(item.end, dayEndMs) - wallClockFraction(item.start, dayEndMs),
    stackIndex: item.stackIndex,
    elevation: item.elevation,
    columnIndex: item.columnIndex,
    columnCount: item.columnCount,
    columnSpan: item.columnSpan,
    tiled: item.tiled,
  }));
}

export interface DayEvents {
  timed: CalendarEvent[];
  allDay: CalendarEvent[];
}

const getDayEvents = (buckets: Map<number, DayEvents>, dayKey: number): DayEvents => {
  let bucket = buckets.get(dayKey);
  if (!bucket) {
    bucket = { timed: [], allDay: [] };
    buckets.set(dayKey, bucket);
  }
  return bucket;
};

// Buckets by local-midnight getTime() key; ends are exclusive, so an event ending at midnight stays on the day it ends.
export function bucketEventsByDay(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): Map<number, DayEvents> {
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  const rangeDayCount = Math.round((rangeEndMs - rangeStartMs) / MS_PER_DAY);
  const utcBase = Date.UTC(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const buckets = new Map<number, DayEvents>();

  for (const event of events) {
    const startMs = event.startTime.getTime();
    const endMs = event.endTime.getTime();

    if (event.isAllDay) {
      // All-day bounds are UTC midnights; map onto local days by index, never by comparing instants.
      const firstIndex = Math.max(Math.round((startMs - utcBase) / MS_PER_DAY), 0);
      const lastIndex = Math.min(
        Math.round((endMs - MS_PER_DAY - utcBase) / MS_PER_DAY),
        rangeDayCount - 1,
      );
      for (let index = firstIndex; index <= lastIndex; index++) {
        getDayEvents(buckets, addDays(rangeStart, index).getTime()).allDay.push(event);
      }
      continue;
    }

    // A zero-length event still claims its start day under the exclusive end.
    const occupiedEndMs = Math.max(endMs, startMs + 1);
    if (occupiedEndMs <= rangeStartMs || startMs >= rangeEndMs) continue;
    const lastMs = Math.min(occupiedEndMs, rangeEndMs);
    for (
      let day = startOfDay(new Date(Math.max(startMs, rangeStartMs)));
      day.getTime() < lastMs;
      day = addDays(day, 1)
    ) {
      getDayEvents(buckets, day.getTime()).timed.push(event);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.timed.sort(byStartTime);
    bucket.allDay.sort(byStartTime);
  }
  return buckets;
}

const byStartTime = (first: CalendarEvent, second: CalendarEvent): number =>
  first.startTime.getTime() - second.startTime.getTime();

export const EVENT_PILL_HEIGHT_PX = 18;
export const EVENT_PILL_GAP_PX = 2;

/** All pills when they fit, else one row fewer with the last row spent on "+N more". */
export function resolveVisiblePillCount(
  eventCount: number,
  availableRows: number,
): { visibleCount: number; hiddenCount: number } {
  const visibleCount =
    eventCount <= availableRows ? eventCount : Math.max(availableRows - 1, 0);
  return { visibleCount, hiddenCount: eventCount - visibleCount };
}

export function resolvePillRows(availableHeight: number): number {
  const rowPitch = EVENT_PILL_HEIGHT_PX + EVENT_PILL_GAP_PX;
  return Math.max(Math.floor((availableHeight + EVENT_PILL_GAP_PX) / rowPitch), 0);
}
