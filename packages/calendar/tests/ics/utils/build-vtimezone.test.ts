import { describe, expect, it } from "vitest";
import {
  convertIcsCalendar,
  generateIcsCalendar,
  timeZoneOffsetToMilliseconds,
} from "ts-ics";
import type { IcsCalendar, IcsTimezone, IcsTimezoneProp } from "ts-ics";
import { RRule } from "rrule";
import type { Weekday } from "rrule";
import { buildVtimezone } from "../../../src/ics/utils/build-vtimezone";
import { wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";

interface RenderedTimezone {
  ics: string;
  timezone: IcsTimezone;
}

interface ExpandedObservance {
  localOnset: Date;
  offsetFromMilliseconds: number;
  offsetToMilliseconds: number;
}

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;

const WEEKDAYS: Record<string, Weekday> = {
  FR: RRule.FR,
  MO: RRule.MO,
  SA: RRule.SA,
  SU: RRule.SU,
  TH: RRule.TH,
  TU: RRule.TU,
  WE: RRule.WE,
};

const renderAndParseVtimezone = (timezone: string, reference: Date): RenderedTimezone => {
  const builtTimezone = buildVtimezone(timezone, reference);
  if (!builtTimezone) {
    throw new Error(`Expected ${timezone} to resolve`);
  }
  const calendar: IcsCalendar = {
    version: "2.0",
    prodId: "-//Test//Test//EN",
    timezones: [builtTimezone],
    events: [],
  };
  const ics = generateIcsCalendar(calendar);
  const parsed = convertIcsCalendar(globalThis.undefined, ics);
  const [parsedTimezone] = parsed.timezones ?? [];
  if (!parsedTimezone) {
    throw new Error(`Expected ts-ics to parse the emitted ${timezone} VTIMEZONE`);
  }
  return { ics, timezone: parsedTimezone };
};

const toLocalOnset = (prop: IcsTimezoneProp): Date =>
  new Date(prop.start.getTime() + timeZoneOffsetToMilliseconds(prop.offsetTo));

const expandObservance = (
  prop: IcsTimezoneProp,
  wallTime: Date,
): ExpandedObservance[] => {
  const firstLocalOnset = toLocalOnset(prop);
  let localOnsets = [firstLocalOnset];
  if (prop.recurrenceRule) {
    const [byDay] = prop.recurrenceRule.byDay ?? [];
    const [byMonth] = prop.recurrenceRule.byMonth ?? [];
    const weekday = byDay && WEEKDAYS[byDay.day];
    if (
      prop.recurrenceRule.frequency !== "YEARLY"
      || !weekday
      || typeof byMonth !== "number"
    ) {
      throw new Error("Expected a yearly VTIMEZONE observance rule");
    }
    let byweekday = weekday;
    if (typeof byDay.occurrence === "number") {
      byweekday = weekday.nth(byDay.occurrence);
    }
    localOnsets = new RRule({
      freq: RRule.YEARLY,
      dtstart: firstLocalOnset,
      bymonth: byMonth + 1,
      byweekday,
    }).between(firstLocalOnset, wallTime, true);
  }

  return localOnsets.map((localOnset) => ({
    localOnset,
    offsetFromMilliseconds: timeZoneOffsetToMilliseconds(prop.offsetFrom),
    offsetToMilliseconds: timeZoneOffsetToMilliseconds(prop.offsetTo),
  }));
};

const resolveWallTimeFromEmittedTimezone = (
  timezone: IcsTimezone,
  wallTime: Date,
): Date => {
  const observances = timezone.props
    .flatMap((prop) => expandObservance(prop, wallTime))
    .filter((observance) => observance.localOnset <= wallTime)
    .toSorted((first, second) =>
      first.localOnset.getTime() - second.localOnset.getTime());
  const current = observances.at(-1);
  if (!current) {
    throw new Error(`No ${timezone.id} observance covers ${wallTime.toISOString()}`);
  }

  let offset = current.offsetToMilliseconds;
  const transitionSize = current.offsetToMilliseconds - current.offsetFromMilliseconds;
  const gapEnd = current.localOnset.getTime() + transitionSize;
  if (
    transitionSize > 0
    && wallTime.getTime() >= current.localOnset.getTime()
    && wallTime.getTime() < gapEnd
  ) {
    offset = current.offsetFromMilliseconds;
  }
  return new Date(wallTime.getTime() - offset);
};

const REFERENCE = new Date("2026-06-17T12:00:00.000Z");

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

const getOffsetFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = offsetFormatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  offsetFormatters.set(timeZone, formatter);
  return formatter;
};

const offsetMillisecondsAt = (instant: Date, timeZone: string): number => {
  const timeZoneName = getOffsetFormatter(timeZone)
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!timeZoneName) {
    throw new Error(`No offset name for ${timeZone} at ${instant.toISOString()}`);
  }
  if (timeZoneName === "GMT") {
    return 0;
  }
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(timeZoneName);
  if (!match) {
    throw new Error(`Unparseable offset name ${timeZoneName}`);
  }
  const [, sign, hours, minutes] = match;
  const magnitude = (Number(hours) * MINUTES_PER_HOUR + Number(minutes)) * MS_PER_MINUTE;
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

interface ScannedTransition {
  instant: Date;
  offsetFromMilliseconds: number;
  offsetToMilliseconds: number;
}

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const scanIntlTransitions = (timeZone: string, start: Date, end: Date): ScannedTransition[] => {
  const transitions: ScannedTransition[] = [];
  let previousProbe = start.getTime();
  let previousOffset = offsetMillisecondsAt(start, timeZone);
  for (let probe = previousProbe + MS_PER_DAY; probe <= end.getTime(); probe += MS_PER_DAY) {
    const offset = offsetMillisecondsAt(new Date(probe), timeZone);
    if (offset !== previousOffset) {
      let low = previousProbe;
      let high = probe;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetMillisecondsAt(new Date(middle), timeZone) === previousOffset) {
          low = middle;
        } else {
          high = middle;
        }
      }
      transitions.push({
        instant: new Date(high),
        offsetFromMilliseconds: previousOffset,
        offsetToMilliseconds: offset,
      });
    }
    previousProbe = probe;
    previousOffset = offset;
  }
  return transitions;
};

describe("buildVtimezone", () => {
  it("emits Outlook-compatible annual rules only after validating the full projection", () => {
    const { ics, timezone } = renderAndParseVtimezone("Europe/Berlin", REFERENCE);

    expect(ics).toContain("TZID:Europe/Berlin");
    expect(ics).toContain("DTSTART:20250330T020000");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3");
    expect(ics).toContain("TZOFFSETFROM:+0100");
    expect(ics).toContain("TZOFFSETTO:+0200");
    expect(ics).toContain("DTSTART:20251026T030000");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10");
    expect(timezone.props).toHaveLength(3);
  });

  it("does not invent a perpetual rule for Morocco's moving Ramadan transitions", () => {
    // Casablanca's Ramadan transition dates differ across tzdata releases, so expectations derive from the runtime's own zone data via Intl.
    const zone = "Africa/Casablanca";
    const { ics, timezone } = renderAndParseVtimezone(zone, REFERENCE);

    expect(ics).not.toContain("RRULE");

    const emitted = timezone.props
      .filter((prop) => prop.offsetFrom !== prop.offsetTo)
      .map((prop) => {
        const offsetFromMilliseconds = timeZoneOffsetToMilliseconds(prop.offsetFrom);
        const offsetToMilliseconds = timeZoneOffsetToMilliseconds(prop.offsetTo);
        return {
          instant: new Date(
            prop.start.getTime() + offsetToMilliseconds - offsetFromMilliseconds,
          ),
          offsetFromMilliseconds,
          offsetToMilliseconds,
        };
      });

    for (const transition of emitted) {
      expect(offsetMillisecondsAt(new Date(transition.instant.getTime() - 1), zone))
        .toBe(transition.offsetFromMilliseconds);
      expect(offsetMillisecondsAt(transition.instant, zone))
        .toBe(transition.offsetToMilliseconds);
    }

    const referenceYear = REFERENCE.getUTCFullYear();
    const scanned = scanIntlTransitions(
      zone,
      new Date(Date.UTC(referenceYear, 0, 1)),
      new Date(Date.UTC(referenceYear + 50, 0, 1)),
    );

    expect(scanned.length).toBeGreaterThan(0);

    const onsetDates = new Set(scanned.map(({ instant, offsetFromMilliseconds }) => {
      const localOnset = new Date(instant.getTime() + offsetFromMilliseconds);
      return `${localOnset.getUTCMonth()}-${localOnset.getUTCDate()}`;
    }));
    expect(onsetDates.size).toBeGreaterThan(2);

    const emittedByInstant = new Map(emitted.map((transition) => [
      transition.instant.getTime(),
      transition,
    ]));
    for (const transition of scanned) {
      expect(emittedByInstant.get(transition.instant.getTime())).toMatchObject({
        offsetFromMilliseconds: transition.offsetFromMilliseconds,
        offsetToMilliseconds: transition.offsetToMilliseconds,
      });
    }
  });

  it("preserves southern-hemisphere transition direction", () => {
    const { ics } = renderAndParseVtimezone("Australia/Sydney", REFERENCE);

    expect(ics).toContain("DTSTART:20250406T030000");
    expect(ics).toContain("TZOFFSETFROM:+1100");
    expect(ics).toContain("TZOFFSETTO:+1000");
    expect(ics).toContain("DTSTART:20251005T020000");
    expect(ics).toContain("TZOFFSETFROM:+1000");
    expect(ics).toContain("TZOFFSETTO:+1100");
  });

  it("preserves non-hour transition sizes", () => {
    const { ics } = renderAndParseVtimezone("Australia/Lord_Howe", REFERENCE);

    expect(ics).toContain("TZOFFSETFROM:+1100");
    expect(ics).toContain("TZOFFSETTO:+1030");
    expect(ics).toContain("TZOFFSETFROM:+1030");
    expect(ics).toContain("TZOFFSETTO:+1100");
  });

  it.each([
    ["America/New_York", "2026-03-08T02:30:00.000Z"],
    ["America/New_York", "2026-11-01T01:30:00.000Z"],
    ["America/New_York", "2098-06-17T09:00:00.000Z"],
    ["Australia/Sydney", "2026-04-05T02:30:00.000Z"],
    ["Australia/Sydney", "2026-10-04T02:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-04-05T01:45:00.000Z"],
    ["Australia/Lord_Howe", "2026-10-04T02:15:00.000Z"],
    ["Africa/Casablanca", "2026-02-15T02:30:00.000Z"],
    ["Africa/Casablanca", "2026-03-22T02:30:00.000Z"],
    ["Africa/Casablanca", "2030-01-20T09:00:00.000Z"],
  ])("resolves %s wall time %s to the same instant as recurrence materialization", (zone, iso) => {
    const { timezone } = renderAndParseVtimezone(zone, REFERENCE);
    const wallTime = new Date(iso);

    expect(resolveWallTimeFromEmittedTimezone(timezone, wallTime))
      .toEqual(wallTimeToInstant(wallTime, zone));
  });

  it("emits one baseline observance for a fixed-offset zone", () => {
    const { ics, timezone } = renderAndParseVtimezone("America/Montevideo", REFERENCE);

    expect(ics).toContain("TZOFFSETFROM:-0300");
    expect(ics).toContain("TZOFFSETTO:-0300");
    expect(ics).not.toContain("BEGIN:DAYLIGHT");
    expect(ics).not.toContain("RRULE");
    expect(timezone.props).toHaveLength(1);
  });

  it("normalizes Windows timezone identifiers", () => {
    const { ics } = renderAndParseVtimezone("W. Europe Standard Time", REFERENCE);
    expect(ics).toContain("TZID:Europe/Berlin");
  });

  it("reuses the expensive projection for the same zone and reference year", () => {
    const first = buildVtimezone("America/New_York", new Date("2026-01-01T00:00:00.000Z"));
    const second = buildVtimezone("America/New_York", new Date("2026-12-31T23:59:59.000Z"));

    expect(second).toBe(first);
  });

  it("does not let an old event truncate timezone rules for current and future events", () => {
    const { timezone } = renderAndParseVtimezone(
      "America/New_York",
      new Date("1970-06-17T12:00:00.000Z"),
    );
    const wallTime = new Date("2098-06-17T09:00:00.000Z");

    expect(resolveWallTimeFromEmittedTimezone(timezone, wallTime))
      .toEqual(wallTimeToInstant(wallTime, "America/New_York"));
  });

  it("rejects invalid timezone input and invalid reference dates", () => {
    expect(buildVtimezone("Not/AZone", REFERENCE)).toBeUndefined();
    expect(buildVtimezone("", REFERENCE)).toBeUndefined();
    expect(buildVtimezone("Europe/Berlin", new Date("invalid"))).toBeUndefined();
  });
});
