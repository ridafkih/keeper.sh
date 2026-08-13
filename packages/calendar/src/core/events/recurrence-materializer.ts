import type { IcsRecurrenceRule } from "ts-ics";
import { RRule } from "rrule";
import type { Frequency, Options, Weekday } from "rrule";
import type { MaterializedSyncableEvent, SourceEvent, SyncableEvent } from "../types";
import {
  instantToWallTime,
  resolveTimeZone,
  wallTimeToInstant,
} from "../../ics/utils/timezone-instant";
import {
  addIcsDuration,
  getIcsDurationNominalMilliseconds,
} from "../../ics/utils/recurrence-duration";
import { overlapsTimeWindow } from "./time-range";
import { resolveIsAllDayEvent } from "./all-day";
import { MS_PER_DAY } from "@keeper.sh/constants";

interface RecurrenceMaterializationWindow {
  start: Date;
  end: Date;
}

interface RecurrenceMaterializationOptions {
  onSeriesOverBudget?: (error: RecurrenceMaterializationLimitError) => void;
}

interface RecurrenceSeriesIdentity {
  calendarId: string;
  eventId: string;
  eventStateId?: string;
  sourceEventUid: string;
}

class RecurrenceMaterializationLimitError extends RangeError {
  readonly calendarId: string;
  readonly eventId: string;
  readonly eventStateId: string | undefined;
  readonly limit: number;
  readonly sourceEventUid: string;

  constructor(identity: RecurrenceSeriesIdentity, limit: number) {
    super(
      `Recurrence series ${identity.sourceEventUid} exceeds the ${limit} occurrence materialization limit`,
    );
    this.name = "RecurrenceMaterializationLimitError";
    this.calendarId = identity.calendarId;
    this.eventId = identity.eventId;
    this.eventStateId = identity.eventStateId;
    this.limit = limit;
    this.sourceEventUid = identity.sourceEventUid;
  }
}

const MAX_OCCURRENCES_PER_SERIES = 10_000;
const HIGH_FREQUENCY_INTERVAL_MS: Partial<Record<IcsRecurrenceRule["frequency"], number>> = {
  HOURLY: 60 * 60 * 1000,
  MINUTELY: 60 * 1000,
  SECONDLY: 1000,
};

const hasOccurrenceSelectors = (rule: IcsRecurrenceRule): boolean => Boolean(
  rule.byDay
  || rule.byHour
  || rule.byMinute
  || rule.byMonth
  || rule.byMonthday
  || rule.bySecond
  || rule.bySetPos
  || rule.byWeekNo
  || rule.byYearday,
);

const assertUnfilteredHighFrequencyRuleWithinBudget = (
  master: SyncableEvent,
  recurrenceStart: Date,
  recurrenceWindowStart: Date,
  recurrenceEnd: Date,
  timeZone: string | undefined,
): void => {
  const rule = master.recurrenceRule;
  if (!rule) {
    return;
  }
  const baseInterval = HIGH_FREQUENCY_INTERVAL_MS[rule.frequency];
  if (!baseInterval) {
    return;
  }
  if (hasOccurrenceSelectors(rule)) {
    return;
  }
  const interval = Math.max(rule.interval ?? 1, 1);
  const intervalMilliseconds = baseInterval * interval;
  let untilTime = recurrenceEnd.getTime();
  if (rule.until) {
    let until = rule.until.date;
    if (timeZone) {
      until = instantToWallTime(until, timeZone);
    }
    untilTime = until.getTime();
  }
  const boundedEndTime = Math.min(recurrenceEnd.getTime(), untilTime);
  const firstOccurrenceIndex = Math.max(
    Math.ceil(
      (recurrenceWindowStart.getTime() - recurrenceStart.getTime()) / intervalMilliseconds,
    ),
    0,
  );
  let lastOccurrenceIndex = Math.floor(
    (boundedEndTime - recurrenceStart.getTime()) / intervalMilliseconds,
  );
  if (typeof rule.count === "number") {
    lastOccurrenceIndex = Math.min(lastOccurrenceIndex, rule.count - 1);
  }
  const potentialOccurrences = Math.max(
    lastOccurrenceIndex - firstOccurrenceIndex + 1,
    0,
  );
  if (potentialOccurrences > MAX_OCCURRENCES_PER_SERIES) {
    throw new RecurrenceMaterializationLimitError({
      calendarId: master.calendarId,
      eventId: master.id,
      eventStateId: master.eventStateId,
      sourceEventUid: master.sourceEventUid,
    }, MAX_OCCURRENCES_PER_SERIES);
  }
};
const assertValidWindow = (window: RecurrenceMaterializationWindow): void => {
  if (
    Number.isNaN(window.start.getTime())
    || Number.isNaN(window.end.getTime())
    || window.start >= window.end
  ) {
    throw new RangeError("Recurrence materialization requires a valid, non-empty window");
  }
};

const overlapsWindow = (
  event: Pick<SyncableEvent, "startTime" | "endTime">,
  window: RecurrenceMaterializationWindow,
): boolean => overlapsTimeWindow(event, window.start, window.end);

const toRecurrenceWallTime = (date: Date, timeZone: string | undefined): Date => {
  if (!timeZone) {
    return date;
  }
  return instantToWallTime(date, timeZone);
};

const fromRecurrenceWallTime = (date: Date, timeZone: string | undefined): Date => {
  if (!timeZone) {
    return date;
  }
  return wallTimeToInstant(date, timeZone);
};

/*
 * `until` is the only termination a rule states up front. `count` also terminates, but
 * finding its last occurrence means walking the series, which is the work being avoided.
 * Both sides move into the wall-time space the expansion runs in, so this answers exactly
 * what `RRule.between(recurrenceWindowStart, ...)` would, without timezone skew.
 */
const isSeriesExhaustedBeforeWindow = (
  rule: IcsRecurrenceRule,
  recurrenceWindowStart: Date,
  timeZone: string | undefined,
): boolean => {
  if (!rule.until) {
    return false;
  }

  return toRecurrenceWallTime(rule.until.date, timeZone) < recurrenceWindowStart;
};

const FREQUENCIES: Record<IcsRecurrenceRule["frequency"], Frequency> = {
  DAILY: RRule.DAILY,
  HOURLY: RRule.HOURLY,
  MINUTELY: RRule.MINUTELY,
  MONTHLY: RRule.MONTHLY,
  SECONDLY: RRule.SECONDLY,
  WEEKLY: RRule.WEEKLY,
  YEARLY: RRule.YEARLY,
};

const WEEKDAYS: Record<string, Weekday> = {
  FR: RRule.FR,
  MO: RRule.MO,
  SA: RRule.SA,
  SU: RRule.SU,
  TH: RRule.TH,
  TU: RRule.TU,
  WE: RRule.WE,
};

const toRRuleOptions = (
  rule: IcsRecurrenceRule,
  recurrenceStart: Date,
  timeZone: string | undefined,
): Partial<Options> => ({
  freq: FREQUENCIES[rule.frequency],
  dtstart: recurrenceStart,
  ...(typeof rule.interval === "number" && { interval: rule.interval }),
  ...(typeof rule.count === "number" && { count: rule.count }),
  ...(rule.until && { until: toRecurrenceWallTime(rule.until.date, timeZone) }),
  ...(rule.bySecond && { bysecond: rule.bySecond }),
  ...(rule.byMinute && { byminute: rule.byMinute }),
  ...(rule.byHour && { byhour: rule.byHour }),
  ...(rule.byDay && {
    byweekday: rule.byDay.map(({ day, occurrence }) => {
      const weekday = WEEKDAYS[day];
      if (!weekday) {
        throw new RangeError(`Unsupported recurrence weekday: ${day}`);
      }
      if (typeof occurrence === "number") {
        return weekday.nth(occurrence);
      }
      return weekday;
    }),
  }),
  ...(rule.byMonthday && { bymonthday: rule.byMonthday }),
  ...(rule.byYearday && { byyearday: rule.byYearday }),
  ...(rule.byWeekNo && { byweekno: rule.byWeekNo }),
  ...(rule.byMonth && { bymonth: rule.byMonth.map((month) => month + 1) }),
  ...(rule.bySetPos && { bysetpos: rule.bySetPos }),
  ...(rule.workweekStart && { wkst: WEEKDAYS[rule.workweekStart] }),
});

const asOneOffEvent = (event: SyncableEvent): MaterializedSyncableEvent => {
  const {
    exceptionDates: _exceptionDates,
    recurrenceDuration: _recurrenceDuration,
    recurrenceId: _recurrenceId,
    recurrenceRule: _recurrenceRule,
    ...oneOffEvent
  } = event;

  return oneOffEvent;
};

const createSyntheticOccurrenceId = (
  master: SyncableEvent,
  occurrenceStart: Date,
  occurrenceEnd: Date,
): string => {
  const seed = JSON.stringify([
    master.calendarId,
    master.sourceEventUid,
    master.startTime.toISOString(),
    master.endTime.toISOString(),
    occurrenceStart.toISOString(),
    occurrenceEnd.toISOString(),
  ]);
  const hash = new Bun.CryptoHasher("sha256").update(seed).digest("hex");

  return `recurrence-${hash}`;
};

const createMaterializedOccurrence = (
  master: SyncableEvent,
  occurrenceStartWallTime: Date,
  timeZone: string | undefined,
): MaterializedSyncableEvent => {
  const occurrenceStart = fromRecurrenceWallTime(occurrenceStartWallTime, timeZone);
  const resolveOccurrenceEnd = (): Date => {
    if (master.recurrenceDuration) {
      return addIcsDuration(
        occurrenceStart,
        master.recurrenceDuration,
        timeZone,
      );
    }
    const exactDuration = master.endTime.getTime() - master.startTime.getTime();
    return new Date(occurrenceStart.getTime() + exactDuration);
  };
  const occurrenceEnd = resolveOccurrenceEnd();

  return asOneOffEvent({
    ...master,
    endTime: occurrenceEnd,
    eventStateId: master.eventStateId ?? master.id,
    id: createSyntheticOccurrenceId(master, occurrenceStart, occurrenceEnd),
    startTime: occurrenceStart,
  });
};

const getEventSortKey = (event: SyncableEvent): string => JSON.stringify([
  event.startTime.toISOString(),
  event.endTime.toISOString(),
  event.calendarId,
  event.sourceEventUid,
  event.id,
  event.summary,
  event.description ?? "",
  event.location ?? "",
  event.availability ?? "",
  event.isAllDay ?? false,
  event.startTimeZone ?? "",
]);

const compareEvents = (first: SyncableEvent, second: SyncableEvent): number => {
  const firstKey = getEventSortKey(first);
  const secondKey = getEventSortKey(second);

  if (firstKey < secondKey) {
    return -1;
  }
  if (firstKey > secondKey) {
    return 1;
  }
  return 0;
};

const getSeriesKey = (event: SyncableEvent): string =>
  JSON.stringify([event.calendarId, event.sourceEventUid]);

const getUniqueMastersBySeries = (events: SyncableEvent[]): Map<string, SyncableEvent> => {
  const mastersBySeries = new Map<string, SyncableEvent[]>();

  for (const event of events) {
    if (!event.recurrenceRule || event.recurrenceId) {
      continue;
    }

    const seriesKey = getSeriesKey(event);
    const masters = mastersBySeries.get(seriesKey) ?? [];
    masters.push(event);
    mastersBySeries.set(seriesKey, masters);
  }

  const uniqueMasters = new Map<string, SyncableEvent>();
  for (const [seriesKey, masters] of mastersBySeries) {
    if (masters.length === 1 && masters[0]) {
      uniqueMasters.set(seriesKey, masters[0]);
    }
  }

  return uniqueMasters;
};

const getOverriddenSlotsByMaster = (
  events: SyncableEvent[],
  uniqueMastersBySeries: Map<string, SyncableEvent>,
): Map<SyncableEvent, Set<number>> => {
  const slotsByMaster = new Map<SyncableEvent, Set<number>>();

  for (const event of events) {
    if (!event.recurrenceId) {
      continue;
    }

    const master = uniqueMastersBySeries.get(getSeriesKey(event));
    if (!master) {
      continue;
    }

    const slots = slotsByMaster.get(master) ?? new Set<number>();
    slots.add(event.recurrenceId.getTime());
    slotsByMaster.set(master, slots);
  }

  return slotsByMaster;
};

// DATE-valued series are floating (RFC 5545 §3.3.10); the zone is still resolved so unsupported ones throw.
const resolveExpansionTimeZone = (master: SyncableEvent): string | undefined => {
  const timeZone = resolveTimeZone(master.startTimeZone);
  if (resolveIsAllDayEvent(master)) {
    return;
  }

  return timeZone;
};

const materializeMaster = (
  master: SyncableEvent,
  overriddenSlots: Set<number>,
  window: RecurrenceMaterializationWindow,
): MaterializedSyncableEvent[] => {
  if (!master.recurrenceRule || master.startTime >= window.end) {
    return [];
  }

  const timeZone = resolveExpansionTimeZone(master);
  const recurrenceStart = toRecurrenceWallTime(master.startTime, timeZone);
  const recurrenceEnd = toRecurrenceWallTime(window.end, timeZone);
  let durationForWindowLookback = master.endTime.getTime() - master.startTime.getTime();
  if (master.recurrenceDuration) {
    durationForWindowLookback = getIcsDurationNominalMilliseconds(master.recurrenceDuration)
      + MS_PER_DAY;
  }
  const recurrenceWindowStart = toRecurrenceWallTime(
    new Date(window.start.getTime() - Math.max(durationForWindowLookback, 0)),
    timeZone,
  );
  if (isSeriesExhaustedBeforeWindow(master.recurrenceRule, recurrenceWindowStart, timeZone)) {
    return [];
  }
  assertUnfilteredHighFrequencyRuleWithinBudget(
    master,
    recurrenceStart,
    recurrenceWindowStart,
    recurrenceEnd,
    timeZone,
  );
  const excludedSlots = new Set(master.exceptionDates?.map((date) => date.getTime()));
  const recurrence = new RRule(toRRuleOptions(
    master.recurrenceRule,
    recurrenceStart,
    timeZone,
  ));
  let occurrenceLimitExceeded = false;
  const occurrenceStarts = recurrence.between(
    recurrenceWindowStart,
    recurrenceEnd,
    true,
    (_date, occurrenceCount) => {
      if (occurrenceCount >= MAX_OCCURRENCES_PER_SERIES) {
        occurrenceLimitExceeded = true;
        return false;
      }
      return true;
    },
  );
  if (occurrenceLimitExceeded) {
    throw new RecurrenceMaterializationLimitError({
      calendarId: master.calendarId,
      eventId: master.id,
      eventStateId: master.eventStateId,
      sourceEventUid: master.sourceEventUid,
    }, MAX_OCCURRENCES_PER_SERIES);
  }

  return occurrenceStarts.flatMap((occurrenceStartWallTime) => {
    const occurrenceStart = fromRecurrenceWallTime(occurrenceStartWallTime, timeZone);
    const slot = occurrenceStart.getTime();
    if (excludedSlots.has(slot) || overriddenSlots.has(slot)) {
      return [];
    }

    const occurrence = createMaterializedOccurrence(
      master,
      occurrenceStartWallTime,
      timeZone,
    );
    if (!overlapsWindow(occurrence, window)) {
      return [];
    }

    return [occurrence];
  });
};

const materializeRecurrenceEvents = (
  events: SyncableEvent[],
  window: RecurrenceMaterializationWindow,
  options: RecurrenceMaterializationOptions = {},
): MaterializedSyncableEvent[] => {
  assertValidWindow(window);

  const uniqueMastersBySeries = getUniqueMastersBySeries(events);
  const overriddenSlotsByMaster = getOverriddenSlotsByMaster(events, uniqueMastersBySeries);
  const materializedEvents: MaterializedSyncableEvent[] = [];
  const { onSeriesOverBudget } = options;
  const skippedSeriesUids = new Set<string>();

  for (const event of events) {
    if (!event.recurrenceRule || event.recurrenceId) {
      continue;
    }
    /*
     * Callers that supply onSeriesOverBudget choose isolation: a series exceeding the
     * budget for a freshly widened window is skipped so it cannot put a whole
     * destination into backoff. Without the handler the limit still throws, so read
     * paths surface it rather than silently returning a partial range.
     */
    try {
      materializedEvents.push(...materializeMaster(
        event,
        overriddenSlotsByMaster.get(event) ?? new Set<number>(),
        window,
      ));
    } catch (error) {
      if (!onSeriesOverBudget || !(error instanceof RecurrenceMaterializationLimitError)) {
        throw error;
      }
      skippedSeriesUids.add(event.sourceEventUid);
      onSeriesOverBudget(error);
    }
  }

  for (const event of events) {
    if (event.recurrenceRule && !event.recurrenceId) {
      continue;
    }
    /*
     * Overrides of a skipped series are dropped with it. Emitting them alone would
     * surface a few detached occurrences with none of the series around them, which
     * reads as a real sparse calendar rather than an omission.
     */
    if (event.recurrenceId && skippedSeriesUids.has(event.sourceEventUid)) {
      continue;
    }
    const oneOffEvent = asOneOffEvent(event);
    if (overlapsWindow(oneOffEvent, window)) {
      materializedEvents.push(oneOffEvent);
    }
  }

  return materializedEvents.toSorted(compareEvents);
};

/*
 * Returns the recurring masters that cannot be materialized within budget over
 * this window. The window is user-configurable, so widening a sync range can pull
 * a pathological series over the limit; callers drop those series rather than
 * failing the whole calendar's ingestion.
 */
const findSourceEventsExceedingRecurrenceBudget = (
  calendarId: string,
  events: SourceEvent[],
  window: RecurrenceMaterializationWindow,
): SourceEvent[] => {
  assertValidWindow(window);
  const exceeded: SourceEvent[] = [];

  for (const event of events) {
    if (!event.recurrenceRule || event.recurrenceId) {
      continue;
    }

    /*
     * Validate over the window the series is actually materialized against. Extending
     * the end by a full window duration past `window.end` over-counts a series that
     * starts inside the window, which now silently withholds it instead of throwing.
     */
    let validationStart = window.start;
    if (event.startTime > window.start) {
      validationStart = event.startTime;
    }
    if (validationStart >= window.end) {
      continue;
    }
    const validationEnd = window.end;
    const master: SyncableEvent = {
      calendarId,
      calendarName: null,
      calendarUrl: null,
      endTime: event.endTime,
      id: event.sourceEventId ?? event.uid,
      recurrenceRule: event.recurrenceRule,
      recurrenceDuration: event.recurrenceDuration,
      sourceEventUid: event.uid,
      startTime: event.startTime,
      summary: event.title ?? "",
      ...(event.startTimeZone && { startTimeZone: event.startTimeZone }),
    };

    try {
      materializeMaster(master, new Set<number>(), {
        end: validationEnd,
        start: validationStart,
      });
    } catch (error) {
      if (!(error instanceof RecurrenceMaterializationLimitError)) {
        throw error;
      }
      exceeded.push(event);
    }
  }

  return exceeded;
};

export {
  findSourceEventsExceedingRecurrenceBudget,
  materializeRecurrenceEvents,
  RecurrenceMaterializationLimitError,
};
export type {
  RecurrenceMaterializationOptions,
  RecurrenceMaterializationWindow,
};
