import type { IcsRecurrenceRule } from "ts-ics";
import { RRule } from "rrule";
import type { Frequency, Options, Weekday } from "rrule";
import type { SyncableEvent } from "../types";
import {
  instantToWallTime,
  resolveTimeZone,
  wallTimeToInstant,
} from "../../ics/utils/timezone-instant";

interface RecurrenceMaterializationWindow {
  start: Date;
  end: Date;
}

const MAX_OCCURRENCES_PER_SERIES = 10_000;
const HIGH_FREQUENCY_INTERVAL_MS: Partial<Record<IcsRecurrenceRule["frequency"], number>> = {
  HOURLY: 60 * 60 * 1000,
  MINUTELY: 60 * 1000,
  SECONDLY: 1000,
};

const assertHighFrequencyRuleWithinBudget = (
  master: SyncableEvent,
  recurrenceStart: Date,
  recurrenceEnd: Date,
): void => {
  const rule = master.recurrenceRule;
  if (!rule) {
    return;
  }
  const baseInterval = HIGH_FREQUENCY_INTERVAL_MS[rule.frequency];
  if (!baseInterval) {
    return;
  }
  const interval = Math.max(rule.interval ?? 1, 1);
  const untilTime = rule.until?.date.getTime() ?? recurrenceEnd.getTime();
  const boundedEndTime = Math.min(recurrenceEnd.getTime(), untilTime);
  const occurrencesBySpan = Math.max(
    Math.floor((boundedEndTime - recurrenceStart.getTime()) / (baseInterval * interval)) + 1,
    0,
  );
  const potentialOccurrences = rule.count ?? occurrencesBySpan;
  if (potentialOccurrences > MAX_OCCURRENCES_PER_SERIES) {
    throw new RangeError(
      `Recurrence series ${master.sourceEventUid} exceeds the ${MAX_OCCURRENCES_PER_SERIES} occurrence materialization limit`,
    );
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
): boolean => event.endTime > window.start && event.startTime < window.end;

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

const asOneOffEvent = (event: SyncableEvent): SyncableEvent => {
  const {
    exceptionDates: _exceptionDates,
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
): SyncableEvent => {
  const masterStartWallTime = toRecurrenceWallTime(master.startTime, timeZone);
  const masterEndWallTime = toRecurrenceWallTime(master.endTime, timeZone);
  const wallDuration = masterEndWallTime.getTime() - masterStartWallTime.getTime();
  const occurrenceStart = fromRecurrenceWallTime(occurrenceStartWallTime, timeZone);
  const occurrenceEnd = fromRecurrenceWallTime(
    new Date(occurrenceStartWallTime.getTime() + wallDuration),
    timeZone,
  );

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

const materializeMaster = (
  master: SyncableEvent,
  overriddenSlots: Set<number>,
  window: RecurrenceMaterializationWindow,
): SyncableEvent[] => {
  if (!master.recurrenceRule || master.startTime >= window.end) {
    return [];
  }

  const timeZone = resolveTimeZone(master.startTimeZone);
  const recurrenceStart = toRecurrenceWallTime(master.startTime, timeZone);
  const recurrenceEnd = toRecurrenceWallTime(window.end, timeZone);
  const wallDuration = toRecurrenceWallTime(master.endTime, timeZone).getTime()
    - recurrenceStart.getTime();
  const recurrenceWindowStart = toRecurrenceWallTime(
    new Date(window.start.getTime() - Math.max(wallDuration, 0)),
    timeZone,
  );
  assertHighFrequencyRuleWithinBudget(master, recurrenceStart, recurrenceEnd);
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
    throw new RangeError(
      `Recurrence series ${master.sourceEventUid} exceeds the ${MAX_OCCURRENCES_PER_SERIES} occurrence materialization limit`,
    );
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
): SyncableEvent[] => {
  assertValidWindow(window);

  const uniqueMastersBySeries = getUniqueMastersBySeries(events);
  const overriddenSlotsByMaster = getOverriddenSlotsByMaster(events, uniqueMastersBySeries);
  const materializedEvents: SyncableEvent[] = [];

  for (const event of events) {
    if (event.recurrenceRule && !event.recurrenceId) {
      materializedEvents.push(...materializeMaster(
        event,
        overriddenSlotsByMaster.get(event) ?? new Set<number>(),
        window,
      ));
      continue;
    }

    const oneOffEvent = asOneOffEvent(event);
    if (overlapsWindow(oneOffEvent, window)) {
      materializedEvents.push(oneOffEvent);
    }
  }

  return materializedEvents.toSorted(compareEvents);
};

export { materializeRecurrenceEvents };
export type { RecurrenceMaterializationWindow };
