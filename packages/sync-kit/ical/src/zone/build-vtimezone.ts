import type { Instant, ZoneId } from "@keeper.sh/sync-protocol";
import { IcsInternalDataError } from "../errors";
import type { IcsOptions } from "../options";
import { normalizeZoneIdentifier } from "./normalize-zone-id";
import { formatUtcOffset, millisecondsInMinute, offsetMinutesAt, padded } from "./offset";
import { findZoneTransitions } from "./transitions";
import { instantOf } from "./wall-time";
import type { ZoneCache } from "./zone-cache";
import { weekdayFormatter } from "./zone-cache";

type VtimezoneBlock =
  | { readonly kind: "annualRule"; readonly text: string }
  | { readonly kind: "explicitObservances"; readonly text: string }
  | { readonly kind: "unresolvableZone"; readonly identifier: string };

interface ProjectedObservance {
  readonly month: number;
  readonly weekday: string;
  readonly ordinal: string;
  readonly time: string;
  readonly wallStart: string;
  readonly offsetFrom: number;
  readonly offsetTo: number;
}

const weekdayCodes: Record<string, string> = {
  Sun: "SU",
  Mon: "MO",
  Tue: "TU",
  Wed: "WE",
  Thu: "TH",
  Fri: "FR",
  Sat: "SA",
};

const millisecondsInSecond = 1000;

const weekdayCodeOf = (weekdays: Intl.DateTimeFormat, atMs: number): string => {
  const rendered = weekdays.format(new Date(atMs));
  const code = weekdayCodes[rendered];
  if (!code) {
    throw new IcsInternalDataError(`the platform rendered an unreadable weekday: ${rendered}`);
  }
  return code;
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const ordinalOf = (year: number, month: number, day: number): string => {
  if (day + 7 > daysInMonth(year, month)) {
    return "-1";
  }
  return String(Math.floor((day - 1) / 7) + 1);
};

const observanceAt = (
  zones: ZoneCache,
  zoneValue: string,
  weekdays: Intl.DateTimeFormat,
  transition: Instant,
): ProjectedObservance => {
  const atMs = Date.parse(transition.value);
  const offsetTo = offsetMinutesAt(zones, zoneValue, atMs);
  const offsetFrom = offsetMinutesAt(zones, zoneValue, atMs - millisecondsInMinute);
  const local = new Date(atMs + offsetFrom * millisecondsInMinute);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const time = `${padded(local.getUTCHours(), 2)}${padded(local.getUTCMinutes(), 2)}${padded(local.getUTCSeconds(), 2)}`;
  return {
    month,
    weekday: weekdayCodeOf(weekdays, atMs - millisecondsInSecond),
    ordinal: ordinalOf(year, month, day),
    time,
    wallStart: `${padded(year, 4)}${padded(month, 2)}${padded(day, 2)}T${time}`,
    offsetFrom,
    offsetTo,
  };
};

const observanceText = (name: string, observance: ProjectedObservance, rule: string | null): string => {
  const lines = [
    `BEGIN:${name}`,
    `DTSTART:${observance.wallStart}`,
    `TZOFFSETFROM:${formatUtcOffset(observance.offsetFrom)}`,
    `TZOFFSETTO:${formatUtcOffset(observance.offsetTo)}`,
  ];
  if (rule) {
    lines.push(rule);
  }
  lines.push(`END:${name}`);
  return lines.join("\r\n");
};

const annualRuleFor = (observance: ProjectedObservance): string =>
  `RRULE:FREQ=YEARLY;BYMONTH=${observance.month};BYDAY=${observance.ordinal}${observance.weekday}`;

const sharesOnePattern = (group: readonly ProjectedObservance[]): boolean => {
  const [first] = group;
  if (!first) {
    return false;
  }
  return group.every(
    (observance) =>
      observance.month === first.month &&
      observance.weekday === first.weekday &&
      observance.ordinal === first.ordinal &&
      observance.time === first.time &&
      observance.offsetFrom === first.offsetFrom &&
      observance.offsetTo === first.offsetTo,
  );
};

const wrapped = (zoneValue: string, blocks: readonly string[]): string =>
  ["BEGIN:VTIMEZONE", `TZID:${zoneValue}`, ...blocks, "END:VTIMEZONE"].join("\r\n");

const baselineObservance = (
  zones: ZoneCache,
  zoneValue: string,
  referenceYear: number,
): ProjectedObservance => {
  const atMs = Date.UTC(referenceYear, 0, 1);
  const offset = offsetMinutesAt(zones, zoneValue, atMs);
  return {
    month: 1,
    weekday: "SU",
    ordinal: "1",
    time: "000000",
    wallStart: `${padded(referenceYear, 4)}0101T000000`,
    offsetFrom: offset,
    offsetTo: offset,
  };
};

const explicitBlock = (
  zoneValue: string,
  baseline: ProjectedObservance,
  observances: readonly ProjectedObservance[],
): VtimezoneBlock => {
  const blocks = observances.map((observance) => {
    if (observance.offsetTo > observance.offsetFrom) {
      return observanceText("DAYLIGHT", observance, null);
    }
    return observanceText("STANDARD", observance, null);
  });
  return {
    kind: "explicitObservances",
    text: wrapped(zoneValue, [observanceText("STANDARD", baseline, null), ...blocks]),
  };
};

const projectionWindow = (referenceYear: number, years: number): { start: Instant; end: Instant } => ({
  start: instantOf(Date.UTC(referenceYear, 0, 1)),
  end: instantOf(Date.UTC(referenceYear + years, 0, 1)),
});

const projectVtimezone = (
  zoneValue: string,
  referenceYear: number,
  options: IcsOptions,
): VtimezoneBlock => {
  const { zones } = options;
  const years = options.limits.zoneProjectionYears;
  const weekdays = weekdayFormatter(zones, zoneValue);
  const transitions = findZoneTransitions(
    { kind: "zoneId", value: zoneValue },
    projectionWindow(referenceYear, years),
    zones,
    options.limits,
  );
  const baseline = baselineObservance(zones, zoneValue, referenceYear);
  const observances = transitions.map((transition) =>
    observanceAt(zones, zoneValue, weekdays, transition),
  );
  const daylight = observances.filter((observance) => observance.offsetTo > observance.offsetFrom);
  const standard = observances.filter((observance) => observance.offsetTo < observance.offsetFrom);
  const [firstDaylight] = daylight;
  const [firstStandard] = standard;
  if (
    !firstDaylight ||
    !firstStandard ||
    daylight.length !== years ||
    standard.length !== years ||
    !sharesOnePattern(daylight) ||
    !sharesOnePattern(standard)
  ) {
    return explicitBlock(zoneValue, baseline, observances);
  }
  return {
    kind: "annualRule",
    text: wrapped(zoneValue, [
      observanceText("STANDARD", firstStandard, annualRuleFor(firstStandard)),
      observanceText("DAYLIGHT", firstDaylight, annualRuleFor(firstDaylight)),
    ]),
  };
};

const buildVtimezone = (zone: ZoneId, referenceYear: number, options: IcsOptions): VtimezoneBlock => {
  const zoneValue = normalizeZoneIdentifier(zone.value);
  if (!zoneValue) {
    return { kind: "unresolvableZone", identifier: zone.value };
  }
  const years = options.limits.zoneProjectionYears;
  options.zones.counters.projectedYears = years;
  const key = `${zoneValue}|${referenceYear}|${years}`;
  const cached = options.zones.vtimezones.get(key);
  if (cached) {
    return cached;
  }
  const built = projectVtimezone(zoneValue, referenceYear, options);
  options.zones.vtimezones.set(key, built);
  return built;
};

export { buildVtimezone };
export type { VtimezoneBlock };
