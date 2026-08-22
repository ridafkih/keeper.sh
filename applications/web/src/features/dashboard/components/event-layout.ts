import type { CalendarEvent } from "@/hooks/use-events";
import { addDays, startOfDay } from "./calendar-helpers";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 86_400_000;

/** Shortest span an event is laid out with. A five-minute event still takes
 * a fifteen-minute slot so it registers on the grid; the card's `min-h`
 * floors the rendered height too, but this floors the *time* geometry, so
 * the overlap and lane decisions see the same box the user does. */
export const MIN_EVENT_SPAN_MS = 15 * MS_PER_MINUTE;

/** When two time-overlapping events start within this window, the cascade's
 * later card would land on the earlier one's header and hide its time and
 * title, so the whole cluster tiles into equal columns instead. qali's
 * week-view value: week columns are narrow and a cascaded card's exposed
 * left sliver is thin, so tiling is preferred eagerly. */
export const TILE_MAX_STAGGER_MS = 45 * MS_PER_MINUTE;

/** Horizontal shift, in pixels, per level of the overlap cascade. */
const STACK_INDENT_PX = 14;
/** Levels that get the full indent before it stops growing. */
const STACK_MAX_LEVELS = 3;
/** Thin residual indent per level past the cap, so deep cards still peek out. */
const STACK_DEEP_STEP_PX = 4;

export interface PositionedEvent {
  event: CalendarEvent;
  /** Distance from the top of the day, as a 0–1 fraction of its height. */
  topFraction: number;
  /** Share of the day's height, 0–1. */
  heightFraction: number;
  /** Cascade depth: how many earlier events in the cluster are still running
   * at this event's start. 0 is the leftmost card; deeper cards indent
   * further right. Drives the horizontal indent only, not the paint order. */
  stackIndex: number;
  /** Paint order within the cluster (0 = earliest start). Higher sits on top,
   * so a later-starting event is never buried under an earlier, longer one. */
  elevation: number;
  /** Column (lane) this event occupies when its cluster tiles. 0 is leftmost. */
  columnIndex: number;
  /** Columns the event's cluster splits into (1 when it stands alone). */
  columnCount: number;
  /** How many columns the card fills once it expands right into free space
   * (at least 1). `columnIndex + columnSpan <= columnCount`. */
  columnSpan: number;
  /** Whether the cluster tiles into equal, non-overlapping columns rather
   * than cascading — see `TILE_MAX_STAGGER_MS`. */
  tiled: boolean;
}

/** Left indent (px) for a card at `stackIndex`, capped so the front cards
 * stay wide in deep overlaps while every card behind still exposes a visible
 * left sliver (the residual keeps the indent monotonic past the cap). */
export function stackIndentPx(stackIndex: number): number {
  const capped = Math.min(stackIndex, STACK_MAX_LEVELS);
  const overflow = Math.max(0, stackIndex - STACK_MAX_LEVELS);
  return capped * STACK_INDENT_PX + overflow * STACK_DEEP_STEP_PX;
}

/** Horizontal box (`left`/`width` as 0–1 fractions of the column) for an
 * event in a tiled cluster: equal columns, with a card widening across
 * `columnSpan` of them when it can expand right into free space. */
export function tileBox(
  columnIndex: number,
  columnCount: number,
  columnSpan: number,
): { left: number; width: number } {
  if (columnCount <= 1) return { left: 0, width: 1 };
  return { left: columnIndex / columnCount, width: columnSpan / columnCount };
}

/** Position of an instant within its day as a fraction of the day's 24 rows,
 * read from the local wall clock rather than elapsed milliseconds: a DST day
 * has 23 or 25 hours, and dividing elapsed time by 86 400 000 would slide
 * every afternoon event a row off its hour. An instant at or past the day's
 * end maps to 1. */
function wallClockFraction(ms: number, dayEndMs: number): number {
  if (ms >= dayEndMs) return 1;
  const date = new Date(ms);
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  return minutes / MINUTES_PER_DAY;
}

interface LayoutItem {
  event: CalendarEvent;
  /** The event's span clamped to the day and floored to `MIN_EVENT_SPAN_MS`, in ms. */
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

/** Lays out one cluster of transitively overlapping events: first-fit lane
 * packing, right-expansion into free lanes, and the cascade-or-tile decision
 * for the cluster as a whole. */
function layoutCluster(cluster: LayoutItem[]): void {
  // Greedy first-fit into lanes: each event reuses the first lane free at
  // its start, or opens a new one.
  const laneEnds: number[] = [];
  for (const item of cluster) {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    item.columnIndex = lane;
  }
  const columnCount = laneEnds.length;

  // Expand each card right into free lanes: stop at the first later-lane
  // event it overlaps in time.
  for (const item of cluster) {
    item.columnCount = columnCount;
    let span = columnCount - item.columnIndex;
    for (const other of cluster) {
      if (other === item || other.columnIndex <= item.columnIndex) continue;
      if (overlaps(item, other)) span = Math.min(span, other.columnIndex - item.columnIndex);
    }
    item.columnSpan = Math.max(span, 1);
  }

  // The cascade reads well when a comfortable stagger keeps every earlier
  // card's header above the next card's top edge. When two overlapping cards
  // start within TILE_MAX_STAGGER_MS the later one would bury the earlier
  // one's header, so the whole cluster tiles into clean columns instead.
  const tiled = cluster.some((item, index) =>
    cluster
      .slice(index + 1)
      .some(
        (other) => overlaps(item, other) && Math.abs(item.start - other.start) < TILE_MAX_STAGGER_MS,
      ),
  );
  for (const item of cluster) item.tiled = tiled;
}

/**
 * Positions a day's timed events, modelled on qali's week view: clamp each
 * to the day, then group transitively overlapping events into clusters. A
 * cluster cascades — each event indents past the earlier events still
 * running at its start (`stackIndex`) and paints in start order
 * (`elevation`), so a later, shorter event sits on top of the earlier ones it
 * overlaps instead of being buried under them — unless two of its events
 * start too close together to stagger legibly, in which case it tiles into
 * equal columns (`columnIndex`/`columnCount`/`columnSpan`).
 */
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

  // Walk events in start order, grouping transitively overlapping ones into
  // clusters (a run of events chained by overlap); each cluster is laid out
  // independently.
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

/** A day's events, split by how the calendar shows them: timed events in the
 * time grid, all-day events in the band above it. */
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

/**
 * Groups events by the local calendar days they overlap inside
 * `[rangeStart, rangeEnd)`, keyed by each day's midnight `getTime()` — the
 * key the grids use for their day cells, all built with `new Date(y, m, d)`.
 * Only the window's days are visited, never the strip's full buffer.
 *
 * Timed events are walked day by day with `addDays`, not in 86 400 000-ms
 * steps, so daylight-saving days stay aligned. The end is exclusive: an event
 * ending at midnight belongs to the day it ends on, not the next, and a
 * zero-length event still lands on its start day.
 *
 * All-day events carry UTC-midnight bounds (a date, not an instant), so their
 * days are read in UTC and mapped onto local days by index — comparing them
 * with a local midnight would shift them by the zone offset and spill a
 * single-day event into a neighbour.
 */
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

    // A zero-length event occupies an instant; give it a millisecond so it
    // still claims its start day under the exclusive end below.
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

  return buckets;
}

/** Height of a one-line event pill (the all-day band and the month grid), and
 * the gap between stacked pills, in pixels. */
export const EVENT_PILL_HEIGHT_PX = 18;
export const EVENT_PILL_GAP_PX = 2;

/** How many of a day's pills to show in `availableRows`: all of them when
 * they fit, otherwise one row fewer, with the last row given over to a
 * "+N more" count so the overflow is never silent. */
export function resolveVisiblePillCount(
  eventCount: number,
  availableRows: number,
): { visibleCount: number; hiddenCount: number } {
  const visibleCount =
    eventCount <= availableRows ? eventCount : Math.max(availableRows - 1, 0);
  return { visibleCount, hiddenCount: eventCount - visibleCount };
}
