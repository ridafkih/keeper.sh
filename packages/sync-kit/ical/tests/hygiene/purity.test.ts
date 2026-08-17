import { describe, expect, test, vi } from "vitest";
import { calendarWith, simpleEvent, testCalendar, testScope } from "../support/feed";
import { testLimits, testOptions } from "../support/options";

const surface = await import("../../src/index");

const body = calendarWith([...simpleEvent("evt-1", "20260310T090000Z", "20260310T100000Z")]);

const representativeArguments: Record<string, readonly unknown[]> = {
  stripByteOrderMark: [body],
  foldContentLine: ["SUMMARY:hello"],
  unfoldContentLines: [body, testLimits()],
  parsePropertyLine: ["SUMMARY:hello"],
  formatPropertyLine: [{ name: "SUMMARY", params: "", value: "hello" }],
  walkComponents: [body, testLimits()],
  applyIcsPatches: [body, surface.defaultIcsPatches, testLimits()],
  normalizeZoneIdentifier: ["Europe/Berlin"],
  createZoneCache: [],
  zoneCacheStatistics: [surface.createZoneCache()],
  zoneOffsetMinutes: [
    { kind: "instant", value: "2026-06-15T10:00:00.000Z" },
    { kind: "zoneId", value: "Europe/Berlin" },
    surface.createZoneCache(),
  ],
  formatUtcOffset: [60],
  resolveWallTime: [
    { kind: "wallTime", value: "20260615T120000" },
    { kind: "zoneId", value: "Europe/Berlin" },
    surface.createZoneCache(),
  ],
  instantToWallTime: [
    { kind: "instant", value: "2026-06-15T10:00:00.000Z" },
    { kind: "zoneId", value: "Europe/Berlin" },
    surface.createZoneCache(),
  ],
  findZoneTransitions: [
    { kind: "zoneId", value: "Europe/Berlin" },
    testScope.window,
    surface.createZoneCache(),
    testLimits(),
  ],
  readDeclaredZones: [body, testLimits()],
  isIanaAuthoritative: [null, { kind: "zoneId", value: "Europe/Berlin" }],
  resolveZoneIdentifier: ["Europe/Berlin", [], surface.createZoneCache()],
  buildVtimezone: [{ kind: "zoneId", value: "Europe/Berlin" }, 2026, testOptions()],
  synthesizeMissingVtimezones: [body, testOptions()],
  parseIcsDocument: [body, testOptions()],
  eventIdentityKey: [{ kind: "master", uid: { kind: "eventUid", value: "evt-1" } }],
  parseIcsDuration: ["PT1H"],
  detectEventLevelRecurrenceDates: [body, testLimits()],
  detectRecurrenceRangeOverrides: [body, testLimits()],
  toPlainTextDescription: ["hello", testLimits()],
  canonicalizeRecurrenceRule: ["FREQ=WEEKLY", surface.utcUntilAnchor],
  withinTimeWindow: [
    testScope.window,
    {
      kind: "timed",
      start: { kind: "instant", value: "2026-06-15T10:00:00.000Z" },
      end: { kind: "instant", value: "2026-06-15T11:00:00.000Z" },
      zone: null,
    },
  ],
  feedContentHash: [body],
  coverageForWholeFeed: [testCalendar],
  projectIcsFeed: [{ body, scope: testScope, previousContentHash: null, options: testOptions() }],
  escapeTextValue: ["a,b"],
  quoteParameterValue: ["a:b"],
  serialiseZonedDate: [
    { kind: "instant", value: "2026-06-15T10:00:00.000Z" },
    { kind: "zoneId", value: "Europe/Berlin" },
    surface.createZoneCache(),
  ],
};

const callableExportNames = (): readonly string[] =>
  Object.entries(surface).flatMap((entry) => {
    const [name, value] = entry;
    if (typeof value !== "function") {
      return [];
    }
    return [name];
  });

const exercisedExportNames = (): readonly string[] =>
  callableExportNames().filter((name) => Boolean(representativeArguments[name]));

const invoke = (name: string): unknown =>
  Reflect.apply(Reflect.get(surface, name), null, representativeArguments[name] ?? []);

const constructorNameOf = (name: string): string => Reflect.get(surface, name).constructor.name;

const isThenable = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
};

describe("the whole public surface", () => {
  test("ICAL-L1: no export is declared async", () => {
    for (const name of callableExportNames()) {
      expect(`${name}:${constructorNameOf(name)}`).not.toContain("AsyncFunction");
    }
    expect(isThenable(invoke("projectIcsFeed"))).toBe(false);
  });

  test("ICAL-L1: nothing a representative call returns is thenable", () => {
    for (const name of exercisedExportNames()) {
      expect(`${name}:${isThenable(invoke(name))}`).toBe(`${name}:false`);
    }
  });

  test("ICAL-L1: a representative call arms no timer, so nothing can wedge on one", () => {
    vi.useFakeTimers();
    try {
      for (const name of exercisedExportNames()) {
        invoke(name);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("ICAL-L1: the sweep actually exercised the surface rather than skipping all of it", () => {
    expect(exercisedExportNames().length).toBeGreaterThanOrEqual(30);
    for (const name of exercisedExportNames()) {
      expect(() => invoke(name)).not.toThrow();
    }
  });
});
