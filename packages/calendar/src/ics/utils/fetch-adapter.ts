import type { SourceEvent } from "../../core/types";
import type { FetchEventsResult } from "../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../utils/safe-fetch";
import { coerceCompliantDate } from "../patches/coerce-compliant-date";
import { parseIcsCalendarLenient } from "./lenient-parser";
import { parseIcsEventsWithDiagnostics } from "./parse-ics-events";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { prepareCalendarSnapshot } from "./create-snapshot";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SourceIngestionPlan } from "../../core/sync/sync-range";
import { normalizeTimezone } from "./normalize-timezone";
import {
  collectRecurrenceDateEventUids,
  resolveRecurrenceTimeZones,
} from "./validate-recurrence-input";
import {
  readDeclaredTimeZoneOffsets,
  resolveDeclaredTimeZone,
} from "./resolve-timezone-identifier";
import type { DeclaredTimeZoneOffsets } from "./resolve-timezone-identifier";
import { wallTimeToInstant } from "./timezone-instant";
import {
  anchorRecurrenceIdentifier,
  expandDateExclusion,
  isDateExclusionEntry,
  readSeriesMasterContext,
  readSeriesMasterContexts,
  toEndOfLocalDayUntil,
  withoutValueParameter,
} from "./series-recurrence-references";
import type { IcsProperty, SeriesMasterContext } from "./series-recurrence-references";
import { measureProviderRequest, measureSyncSegment } from "../../core/telemetry/segments";

interface IcsSourceFetcherConfig {
  calendarId: string;
  url: string;
  database: BunSQLDatabase;
  safeFetchOptions?: SafeFetchOptions;
  plan: SourceIngestionPlan;
}

interface IcsSourceEventContext {
  calendarTimeZone?: string;
}

interface FetchIcsSourceEventsOptions {
  interpretEvents?: (events: SourceEvent[], context: IcsSourceEventContext) => SourceEvent[];
}

interface IcsSourceFetcher {
  fetchEvents: (options?: FetchIcsSourceEventsOptions) => Promise<FetchEventsResult>;
}

const FLOATING_DATE_PROPERTIES = new Set([
  "DTEND",
  "DTSTART",
  "EXDATE",
  "RDATE",
  "RECURRENCE-ID",
]);

const FLOATING_UNTIL_PATTERN = /(^|;)UNTIL=(\d{8}T\d{6})(?=;|$)/i;
const TZID_PARAMETER_PATTERN = /;TZID=(?:"([^"]*)"|([^;:]*))/i;

/**
 * The zone a VEVENT's own DTSTART declares. Recurrence properties that carry no
 * zone of their own are anchored to it, which is what every client means by a
 * floating EXDATE/UNTIL on a zoned series.
 */
interface EventTimeZoneContext {
  isAllDay: boolean;
  timeZone?: string;
}

interface IcsLineBlock {
  insideEvent: boolean;
  lines: string[];
}

interface FloatingEventFailure {
  error: RangeError;
  uid?: string;
}

interface NormalizedFloatingCalendar {
  failures: FloatingEventFailure[];
  ical: string;
}

interface EventFloatingZones {
  declared?: string;
  resolved?: string;
}

const formatUtcIcsDateTime = (date: Date): string =>
  date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const readFloatingWallTime = (recurrenceRuleValue: string): Date => {
  const floatingUntil = FLOATING_UNTIL_PATTERN.exec(recurrenceRuleValue)?.[2] ?? "";
  return new Date(Date.UTC(
    Number(floatingUntil.slice(0, 4)),
    Number(floatingUntil.slice(4, 6)) - 1,
    Number(floatingUntil.slice(6, 8)),
    Number(floatingUntil.slice(9, 11)),
    Number(floatingUntil.slice(11, 13)),
    Number(floatingUntil.slice(13, 15)),
  ));
};

const parseIcsProperty = (line: string): IcsProperty | null => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }
  const property = line.slice(0, separatorIndex);
  const [propertyName, ...parameters] = property.toUpperCase().split(";");
  if (!propertyName) {
    return null;
  }
  return {
    parameters,
    property,
    propertyName,
    value: line.slice(separatorIndex + 1),
  };
};

const readEventTimeZoneContext = (lines: readonly string[]): EventTimeZoneContext => {
  for (const line of lines) {
    const parts = parseIcsProperty(line);
    if (!parts || parts.propertyName !== "DTSTART") {
      continue;
    }
    if (parts.parameters.includes("VALUE=DATE")) {
      return { isAllDay: true };
    }
    const match = TZID_PARAMETER_PATTERN.exec(parts.property);
    const timeZone = match?.[1] ?? match?.[2];
    if (!timeZone) {
      return { isAllDay: false };
    }
    return { isAllDay: false, timeZone };
  }
  return { isAllDay: false };
};

const splitIcsLineBlocks = (lines: readonly string[]): IcsLineBlock[] => {
  const blocks: IcsLineBlock[] = [{ insideEvent: false, lines: [] }];
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    if (upperLine === "BEGIN:VEVENT") {
      blocks.push({ insideEvent: true, lines: [line] });
      continue;
    }
    blocks.at(-1)?.lines.push(line);
    if (upperLine === "END:VEVENT") {
      blocks.push({ insideEvent: false, lines: [] });
    }
  }
  return blocks;
};

const applyTimeZoneToFloatingUntil = (
  line: string,
  timeZone: string,
): string => {
  const separatorIndex = line.indexOf(":");
  const value = line.slice(separatorIndex + 1);
  const instant = wallTimeToInstant(readFloatingWallTime(value), timeZone);
  const normalizedValue = value.replace(
    FLOATING_UNTIL_PATTERN,
    (matched, prefix: string) => `${prefix}UNTIL=${formatUtcIcsDateTime(instant)}`,
  );
  return `${line.slice(0, separatorIndex + 1)}${normalizedValue}`;
};

const normalizeFloatingRecurrenceRule = (
  line: string,
  zones: EventFloatingZones,
): string => {
  const separatorIndex = line.indexOf(":");
  const match = FLOATING_UNTIL_PATTERN.exec(line.slice(separatorIndex + 1));
  if (!match?.[2]) {
    return line;
  }
  if (!zones.declared) {
    throw new RangeError("Floating ICS RRULE UNTIL requires an explicit X-WR-TIMEZONE");
  }
  if (!zones.resolved) {
    /*
     * The event declares a zone this runtime cannot interpret. Leaving UNTIL
     * alone keeps the feed parseable; resolveRecurrenceTimeZones reports the
     * same event as unsupported so it is withheld and counted, not synced with
     * a guessed offset.
     */
    return line;
  }
  return applyTimeZoneToFloatingUntil(line, zones.resolved);
};

const isAbsoluteDateEntry = (entry: string): boolean =>
  entry.endsWith("Z") || /^\d{8}$/.test(entry);

interface DatePropertyEntries {
  absoluteEntries: string[];
  floatingEntries: string[];
}

const splitDatePropertyEntries = (
  parts: IcsProperty,
  dateExclusionMaster: SeriesMasterContext | undefined,
): DatePropertyEntries => {
  const entries: DatePropertyEntries = { absoluteEntries: [], floatingEntries: [] };
  for (const entry of parts.value.split(",")) {
    if (dateExclusionMaster && isDateExclusionEntry(parts, entry)) {
      const slots = expandDateExclusion(entry, dateExclusionMaster);
      entries.absoluteEntries.push(...slots.instants);
      entries.floatingEntries.push(...slots.wallTimes);
    } else if (isAbsoluteDateEntry(entry)) {
      entries.absoluteEntries.push(entry);
    } else {
      entries.floatingEntries.push(entry);
    }
  }
  return entries;
};

const readDateExclusionMaster = (
  parts: IcsProperty,
  master: SeriesMasterContext | undefined,
): SeriesMasterContext | undefined => {
  if (parts.propertyName !== "EXDATE") {
    return;
  }
  return master;
};

const normalizeFloatingDateProperty = (
  line: string,
  parts: IcsProperty,
  zones: EventFloatingZones,
  master: SeriesMasterContext | undefined,
): string[] => {
  const dateExclusionMaster = readDateExclusionMaster(parts, master);
  if (
    !FLOATING_DATE_PROPERTIES.has(parts.propertyName)
    || parts.property.toUpperCase().includes("TZID=")
    || (parts.parameters.includes("VALUE=DATE") && !dateExclusionMaster)
  ) {
    return [line];
  }
  const { absoluteEntries, floatingEntries } = splitDatePropertyEntries(parts, dateExclusionMaster);
  if (floatingEntries.length === 0 && !dateExclusionMaster) {
    return [line];
  }
  if (floatingEntries.length > 0 && !zones.declared) {
    throw new RangeError(
      `Floating ICS ${parts.propertyName} requires an explicit TZID or X-WR-TIMEZONE`,
    );
  }
  const property = withoutValueParameter(parts.property);
  /*
   * A TZID parameter applies to every value on the property, so the absolute
   * entries of a mixed multi-value list are re-emitted on their own line rather
   * than being reinterpreted in the event's zone.
   */
  const lines: string[] = [];
  if (floatingEntries.length > 0) {
    lines.push(`${property};TZID=${zones.declared}:${floatingEntries.join(",")}`);
  }
  if (absoluteEntries.length > 0) {
    lines.push(`${property}:${absoluteEntries.join(",")}`);
  }
  return lines;
};

const normalizeDateUntil = (line: string, master: SeriesMasterContext | undefined): string => {
  if (!master) {
    return line;
  }
  const separatorIndex = line.indexOf(":");
  return `${line.slice(0, separatorIndex + 1)}${toEndOfLocalDayUntil(line.slice(separatorIndex + 1), master)}`;
};

interface EventSeriesContext {
  calendarTimeZone: string | undefined;
  declaredOffsets: DeclaredTimeZoneOffsets;
  mastersByUid: ReadonlyMap<string, SeriesMasterContext>;
}

const readEventUid = (properties: readonly (IcsProperty | null)[]): string | undefined =>
  properties.find((parts) => parts?.propertyName === "UID")?.value;

const toBlockProperties = (block: IcsLineBlock): IcsProperty[] => block.lines
  .map((line) => parseIcsProperty(line))
  .filter((parts) => parts !== null);

const normalizeFloatingEventBlock = (
  block: IcsLineBlock,
  series: EventSeriesContext,
): string[] => {
  const context = readEventTimeZoneContext(block.lines);
  /*
   * An all-day series has no wall-clock zone to resolve against: DTSTART is a
   * date, so a date-time UNTIL or EXDATE on it is compared as a date anyway.
   */
  if (context.isAllDay) {
    return block.lines;
  }
  const declared = context.timeZone ?? series.calendarTimeZone;
  const zones: EventFloatingZones = {
    declared,
    resolved: resolveDeclaredTimeZone(declared, series.declaredOffsets),
  };
  const properties = toBlockProperties(block);
  const ownMaster = readSeriesMasterContext(
    properties,
    series.calendarTimeZone,
    series.declaredOffsets,
  );
  const seriesMaster = series.mastersByUid.get(readEventUid(properties) ?? "");

  return block.lines.flatMap((line) => {
    const parts = parseIcsProperty(line);
    if (!parts) {
      return [line];
    }
    if (parts.propertyName === "RRULE") {
      return [normalizeDateUntil(normalizeFloatingRecurrenceRule(line, zones), ownMaster)];
    }
    const anchored = parts.propertyName === "RECURRENCE-ID"
      && seriesMaster
      && anchorRecurrenceIdentifier(parts, seriesMaster);
    if (anchored) {
      return [anchored];
    }
    return normalizeFloatingDateProperty(line, parts, zones, ownMaster);
  });
};

const normalizeFloatingEventDates = (
  ical: string,
  calendarTimeZone: string | undefined,
): NormalizedFloatingCalendar => {
  const unfolded = ical.replaceAll(/\r?\n[\t ]/g, "");
  const declaredOffsets = readDeclaredTimeZoneOffsets(unfolded);
  const failures: FloatingEventFailure[] = [];
  const blocks = splitIcsLineBlocks(unfolded.split(/\r?\n/));
  const series: EventSeriesContext = {
    calendarTimeZone,
    declaredOffsets,
    mastersByUid: readSeriesMasterContexts(
      blocks.filter(({ insideEvent }) => insideEvent).map((block) => toBlockProperties(block)),
      calendarTimeZone,
      declaredOffsets,
    ),
  };

  const lines = blocks.flatMap((block) => {
    if (!block.insideEvent) {
      return block.lines;
    }
    try {
      return normalizeFloatingEventBlock(block, series);
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      const uid = readEventUid(toBlockProperties(block));
      failures.push({ error, ...uid && { uid } });
      return block.lines;
    }
  });

  return { failures, ical: lines.join("\r\n") };
};

/*
 * For CalDAV, which reads one resource at a time and already quarantines and
 * counts the resources it cannot read.
 */
const applyCalendarTimeZoneToFloatingEventDates = (
  ical: string,
  calendarTimeZone: string | undefined,
): string => {
  const normalized = normalizeFloatingEventDates(ical, calendarTimeZone);
  const [failure] = normalized.failures;
  if (failure) {
    throw failure.error;
  }
  return normalized.ical;
};

const createIcsSourceFetcher = (config: IcsSourceFetcherConfig): IcsSourceFetcher => {
  /**
   * Lets pullRemoteCalendar errors propagate. The previous behavior swallowed
   * them and returned null, which caused ingestSource to treat the empty result
   * as "the source authoritatively has zero events" and delete every existing
   * event_state for the calendar on the next tick. Surfacing the error lets the
   * cron mark the run as failed and leave existing events intact for retry.
   */
  const fetchRemoteIcal = (): Promise<string> => measureProviderRequest(async () => {
    const { ical } = await pullRemoteCalendar("ical", config.url, config.safeFetchOptions);
    return ical;
  });

  const fetchEvents = async (options: FetchIcsSourceEventsOptions = {}): Promise<FetchEventsResult> => {
    const { futureRange, historicRange, window: syncWindow } = config.plan;
    const ical = await fetchRemoteIcal();
    if (!ical) {
      /*
       * Defensive: pullRemoteCalendar already throws on invalid/empty bodies,
       * but if a future change ever returns an empty string here, treat it as
       * unchanged rather than authoritative-empty to keep the no-wipe invariant.
       */
      return { events: [], syncWindow, unchanged: true };
    }
    const recurrenceDateUids = collectRecurrenceDateEventUids(ical);
    const snapshotResult = await prepareCalendarSnapshot(config.database, config.calendarId, ical);
    const { calendarTimeZone, normalized, parsed, recurrenceTimeZones } = measureSyncSegment(
      "work.transform_ms",
      () => {
        const initialCalendar = parseIcsCalendarLenient({
          icsString: ical,
          patches: [coerceCompliantDate],
        });
        const timeZone = normalizeTimezone(initialCalendar.nonStandard?.wrTimezone);
        const normalizedIcal = normalizeFloatingEventDates(ical, timeZone);
        let calendar = initialCalendar;
        if (normalizedIcal.ical !== ical) {
          calendar = parseIcsCalendarLenient({
            icsString: normalizedIcal.ical,
            patches: [coerceCompliantDate],
          });
        }
        const diagnosed = parseIcsEventsWithDiagnostics(calendar);
        return {
          calendarTimeZone: timeZone,
          normalized: normalizedIcal,
          parsed: diagnosed,
          recurrenceTimeZones: resolveRecurrenceTimeZones(
            diagnosed.events,
            readDeclaredTimeZoneOffsets(ical),
          ),
        };
      },
    );
    let events: SourceEvent[] = recurrenceTimeZones.events.map((event) => ({
      availability: event.availability,
      description: event.description,
      endTime: event.endTime,
      exceptionDates: event.exceptionDates,
      recurrenceId: event.recurrenceId,
      isAllDay: event.isAllDay,
      location: event.location,
      recurrenceDuration: event.recurrenceDuration,
      recurrenceRule: event.recurrenceRule,
      sourceEventType: event.sourceEventType,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      title: event.title,
      uid: event.uid,
    }));
    if (options.interpretEvents) {
      events = options.interpretEvents(events, {
        calendarTimeZone,
      });
    }
    /*
     * The whole feed is kept on purpose. ICS storage is unbounded: the sync
     * window bounds what Keeper mirrors to destinations, not what it retains.
     * Filtering here would make the snapshot diff delete the stored state of
     * every historic event on the next ingest.
     */
    /*
     * Unsupported events stay in the returned feed so the snapshot diff still
     * sees them as present: ingestion withholds them from inserts, but treating
     * them as absent would delete the stored state they already have. One event
     * Keeper cannot represent must not fail, or silently empty, the whole feed.
     */
    const unsupportedEventUids = [...new Set([
      ...recurrenceDateUids,
      ...recurrenceTimeZones.unsupportedUids,
      ...parsed.unsupportedEvents.map(({ uid }) => uid),
      ...normalized.failures.flatMap(({ uid }) => uid ?? []),
    ])];
    const result: FetchEventsResult = {
      events,
      // Zero outside the window: an ICS feed is retained whole, never filtered.
      discardedEventCounts: {
        outsideSyncWindow: 0,
        unrepresentable: parsed.unrepresentableCount,
      },
      selfAuthoredEventCount: parsed.selfAuthoredCount,
      syncWindow,
      coverage: {
        futureRange,
        historicRange,
        window: syncWindow,
      },
      ...unsupportedEventUids.length > 0 && { unsupportedEventUids },
    };
    if (snapshotResult.changed && snapshotResult.snapshot) {
      result.snapshot = snapshotResult.snapshot;
    }
    return result;
  };

  return { fetchEvents };
};

export { applyCalendarTimeZoneToFloatingEventDates, createIcsSourceFetcher };
export type {
  FetchIcsSourceEventsOptions,
  IcsSourceEventContext,
  IcsSourceFetcher,
  IcsSourceFetcherConfig,
};
