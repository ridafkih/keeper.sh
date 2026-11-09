import type {
  IcsCalendar,
  IcsDateObject,
  IcsEvent,
  NonStandardValuesGeneric,
} from "ts-ics";
import { readDeclaredZone } from "./declared-timezone-offsets";
import { readDeclaredTimeZoneOffsets, resolveTimeZoneIdentifier } from "./resolve-timezone-identifier";
import type { DeclaredTimeZoneOffsets } from "./resolve-timezone-identifier";
import { formatIcsUtcOffset, ianaOffsetAt, wallTimeToInstantWith } from "./timezone-instant";
import type { ZoneOffsetAt } from "./timezone-instant";

interface ZoneSource {
  offsetAt: ZoneOffsetAt;
  wallTimeToInstant: (wallTime: Date) => Date;
}

type ZoneSourceLookup = (timeZoneId: string) => ZoneSource | undefined;

const ianaZoneSource = (timeZone: string): ZoneSource => {
  const offsetAt = ianaOffsetAt(timeZone);
  return { offsetAt, wallTimeToInstant: (wallTime) => wallTimeToInstantWith(wallTime, offsetAt) };
};

const buildZoneSource = (
  timeZoneId: string,
  blocksByTimeZoneId: ReadonlyMap<string, string>,
  declaredOffsets: DeclaredTimeZoneOffsets,
): ZoneSource | undefined => {
  const resolved = resolveTimeZoneIdentifier(timeZoneId, declaredOffsets);
  if (resolved) {
    return ianaZoneSource(resolved.timeZone);
  }
  const block = blocksByTimeZoneId.get(timeZoneId);
  if (!block) {
    return;
  }
  return readDeclaredZone(block);
};

const createZoneSourceLookup = (blocksByTimeZoneId: ReadonlyMap<string, string>): ZoneSourceLookup => {
  const declaredOffsets = readDeclaredTimeZoneOffsets([...blocksByTimeZoneId.values()].join("\r\n"));
  const sources = new Map<string, ZoneSource | undefined>();
  return (timeZoneId) => {
    if (!sources.has(timeZoneId)) {
      sources.set(timeZoneId, buildZoneSource(timeZoneId, blocksByTimeZoneId, declaredOffsets));
    }
    return sources.get(timeZoneId);
  };
};

const resolveInstant = (source: ZoneSource, wallTime: Date): Date | undefined => {
  try {
    return source.wallTimeToInstant(wallTime);
  } catch (error) {
    if (error instanceof RangeError) {
      return;
    }
    throw error;
  }
};

const resolveZonedValue = (value: IcsDateObject, lookup: ZoneSourceLookup): IcsDateObject | undefined => {
  const { local } = value;
  if (!local || value.type === "DATE") {
    return value;
  }
  const source = lookup(local.timezone);
  if (!source) {
    return;
  }
  const date = resolveInstant(source, local.date);
  if (!date) {
    return;
  }
  return {
    ...value,
    date,
    local: { ...local, tzoffset: formatIcsUtcOffset(Math.round(source.offsetAt(date))) },
  };
};

const hasUnreadableTime = (value: IcsDateObject | undefined): boolean =>
  Boolean(value && Number.isNaN(value.date.getTime()));

const readEventEnd = (event: IcsEvent): IcsDateObject | undefined => {
  if ("end" in event && event.end) {
    return event.end;
  }
  return globalThis.undefined;
};

interface ZonedValueResolver {
  resolve: (value: IcsDateObject) => IcsDateObject;
  unresolvedTimeZoneIds: ReadonlySet<string>;
}

const createZonedValueResolver = (lookup: ZoneSourceLookup): ZonedValueResolver => {
  const unresolvedTimeZoneIds = new Set<string>();
  const resolve = (value: IcsDateObject): IcsDateObject => {
    const resolved = resolveZonedValue(value, lookup);
    if (resolved) {
      return resolved;
    }
    unresolvedTimeZoneIds.add(value.local?.timezone ?? "");
    return value;
  };
  return { resolve, unresolvedTimeZoneIds };
};

const describeUnresolvedTime = (
  event: IcsEvent,
  unresolvedTimeZoneIds: ReadonlySet<string>,
): string | undefined => {
  if (unresolvedTimeZoneIds.size > 0) {
    return `Unsupported calendar timezone: ${[...unresolvedTimeZoneIds].join(", ")}`;
  }
  if (hasUnreadableTime(event.start) || hasUnreadableTime(readEventEnd(event))) {
    return `Unreadable DTSTART or DTEND in event ${event.uid}`;
  }
  return globalThis.undefined;
};

const withUnresolvedTimeReason = <TNonStandardValues extends NonStandardValuesGeneric>(
  unresolvedTimeReason: string,
  nonStandard: Partial<TNonStandardValues> = {},
): Partial<TNonStandardValues> => ({ ...nonStandard, unresolvedTimeReason });

const markUnresolvedTime = <TNonStandardValues extends NonStandardValuesGeneric>(
  event: IcsEvent<TNonStandardValues>,
  unresolvedTimeReason: string | undefined,
): IcsEvent<TNonStandardValues> => {
  if (!unresolvedTimeReason) {
    return event;
  }
  return { ...event, nonStandard: withUnresolvedTimeReason(unresolvedTimeReason, event.nonStandard) };
};

const resolveEventZonedInstants = <TNonStandardValues extends NonStandardValuesGeneric>(
  event: IcsEvent<TNonStandardValues>,
  lookup: ZoneSourceLookup,
): IcsEvent<TNonStandardValues> => {
  const { resolve, unresolvedTimeZoneIds } = createZonedValueResolver(lookup);
  const patch = {
    ...event.exceptionDates && { exceptionDates: event.exceptionDates.map(resolve) },
    ...event.recurrenceId && {
      recurrenceId: { ...event.recurrenceId, value: resolve(event.recurrenceId.value) },
    },
    ...event.recurrenceRule?.until && {
      recurrenceRule: { ...event.recurrenceRule, until: resolve(event.recurrenceRule.until) },
    },
    ...event.start && { start: resolve(event.start) },
  };
  let resolved: IcsEvent<TNonStandardValues> = { ...event, ...patch };
  if ("end" in event && event.end) {
    resolved = { ...event, ...patch, end: resolve(event.end) };
  }
  return markUnresolvedTime(resolved, describeUnresolvedTime(event, unresolvedTimeZoneIds));
};

const resolveCalendarZonedInstants = <TNonStandardValues extends NonStandardValuesGeneric>(
  calendar: IcsCalendar<TNonStandardValues>,
  blocksByTimeZoneId: ReadonlyMap<string, string>,
): IcsCalendar<TNonStandardValues> => {
  const lookup = createZoneSourceLookup(blocksByTimeZoneId);
  return {
    ...calendar,
    ...calendar.events && {
      events: calendar.events.map((event) => resolveEventZonedInstants(event, lookup)),
    },
  };
};

const readUnresolvedTimeReason = (event: IcsEvent): string | undefined => {
  const reason: unknown = event.nonStandard?.unresolvedTimeReason;
  if (typeof reason === "string") {
    return reason;
  }
  return globalThis.undefined;
};

export { readUnresolvedTimeReason, resolveCalendarZonedInstants };
