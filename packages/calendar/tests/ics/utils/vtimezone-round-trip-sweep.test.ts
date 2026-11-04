import { describe, expect, it } from "vitest";
import {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
} from "../../../src/providers/caldav/shared/ics";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import {
  collectTransitions,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  SWEEP_TIMEOUT_MS,
  sweepTimeZones,
} from "./tz-sweep-support";

const HIGH_RISK_ZONES = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Havana",
  "America/Asuncion",
  "Africa/Cairo",
  "America/Santiago",
  "America/Nuuk",
  "Africa/Casablanca",
  "Asia/Jerusalem",
];

const HISTORIC_YEARS: [string, number][] = [
  ["Asia/Manila", 1945],
  ["Europe/Moscow", 2011],
  ["Europe/Moscow", 2014],
  ["Pacific/Apia", 2011],
  ["Asia/Almaty", 2024],
  ["America/Mexico_City", 2022],
  ["America/Nuuk", 2023],
  ["America/Asuncion", 2024],
];

const SWEEP_FROM = Date.UTC(2024, 0, 1);
const SWEEP_TO = Date.UTC(2029, 0, 1);
const EVENT_LENGTH_MS = 30 * MS_PER_MINUTE;

const buildEvent = (startTime: Date, timeZone: string): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date(startTime.getTime() + EVENT_LENGTH_MS),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime,
  startTimeZone: timeZone,
  summary: "Busy",
} as MaterializedSyncableEvent);

const escapePattern = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const declaredIdentifier = (timeZone: string): string => `Declared ${timeZone}`;

const renameToDeclaredIdentifier = (icsString: string, timeZone: string): string => {
  const escaped = escapePattern(timeZone);
  return icsString
    .replaceAll(new RegExp(`^TZID:${escaped}(?=\r?$)`, "gm"), `TZID:${declaredIdentifier(timeZone)}`)
    .replaceAll(new RegExp(`;TZID=${escaped}:`, "g"), `;TZID="${declaredIdentifier(timeZone)}":`);
};

type IcsRewrite = (icsString: string, timeZone: string) => string;

const keepIanaIdentifier: IcsRewrite = (icsString) => icsString;

const floorToHour = (instant: number): number => Math.floor(instant / MS_PER_HOUR) * MS_PER_HOUR;

const collectTransitionDayInstants = (timeZone: string, from: number, to: number): number[] => {
  const instants = new Set<number>();
  for (const transition of collectTransitions(timeZone, from, to)) {
    const first = floorToHour(transition.instant) - MS_PER_DAY;
    for (let instant = first; instant <= first + 2 * MS_PER_DAY; instant += MS_PER_HOUR) {
      instants.add(instant);
    }
  }
  return [...instants];
};

const describeRoundTrip = (
  timeZone: string,
  startTime: Date,
  rewrite: IcsRewrite,
): string | undefined => {
  const event = buildEvent(startTime, timeZone);
  const icsString = rewrite(eventToICalString(event, "destination-uid"), timeZone);
  const resources = parseICalCalendarsToRemoteEvents([icsString]);
  const [parsed] = resources.events;
  const label = `${timeZone} ${startTime.toISOString()}`;
  if (resources.unsupportedEvents.length > 0) {
    return `${label} withheld: ${resources.unsupportedEvents.map(({ reason }) => reason).join("; ")}`;
  }
  if (!parsed) {
    return `${label} not read back`;
  }
  const start = parsed.startTime.getTime();
  const end = parsed.endTime.getTime();
  if (start === event.startTime.getTime() && end === event.endTime.getTime()) {
    return;
  }
  return `${label} read back as ${parsed.startTime.toISOString()}..${parsed.endTime.toISOString()}`;
};

const sweepRoundTrips = (
  timeZones: readonly string[],
  from: number,
  to: number,
  rewrite: IcsRewrite,
): string[] => timeZones.flatMap((timeZone) =>
  collectTransitionDayInstants(timeZone, from, to).flatMap((instant) =>
    describeRoundTrip(timeZone, new Date(instant), rewrite) ?? []));

const sweptZones = (): string[] => [...new Set([...HIGH_RISK_ZONES, ...sweepTimeZones()])];

const yearBounds = (year: number): [number, number] => [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];

describe("reading Keeper's own CalDAV copies back", () => {
  it("returns every instant of every hour around each 2024-2028 transition unchanged in the high-risk zones", () => {
    expect(sweepRoundTrips(HIGH_RISK_ZONES, SWEEP_FROM, SWEEP_TO, keepIanaIdentifier)).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it("returns every instant of every hour around each 2024-2028 transition unchanged across the swept zones", () => {
    expect(sweepRoundTrips(sweepTimeZones(), SWEEP_FROM, SWEEP_TO, keepIanaIdentifier)).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it.each(HISTORIC_YEARS)("returns every hour around the %s transitions of %i unchanged", (timeZone, year) => {
    expect(sweepRoundTrips([timeZone], ...yearBounds(year), keepIanaIdentifier)).toEqual([]);
  }, SWEEP_TIMEOUT_MS);
});

describe("projecting a declared VTIMEZONE whose TZID names no known zone", () => {
  it("matches the IANA instant for every hour around each 2024-2028 transition in every swept zone", () => {
    expect(sweepRoundTrips(sweptZones(), SWEEP_FROM, SWEEP_TO, renameToDeclaredIdentifier)).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it.each(HISTORIC_YEARS)("matches the IANA instant for every hour around the %s transitions of %i", (timeZone, year) => {
    expect(sweepRoundTrips([timeZone], ...yearBounds(year), renameToDeclaredIdentifier)).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it("renames the identifier in both the VTIMEZONE and the event", () => {
    const timeZone = "America/Edmonton";
    const icsString = renameToDeclaredIdentifier(
      eventToICalString(buildEvent(new Date("2026-03-08T12:00:00.000Z"), timeZone), "destination-uid"),
      timeZone,
    );

    expect(icsString).toContain(`TZID:${declaredIdentifier(timeZone)}`);
    expect(icsString).toContain(`DTSTART;TZID="${declaredIdentifier(timeZone)}":`);
    expect(icsString).not.toMatch(new RegExp(`TZID[:=]${escapePattern(timeZone)}`));
  });
});
