import { describe, expect, test } from "vitest";
import { projectIcsFeed, serialiseCalendarResource } from "../../src/index";
import type { CanonicalEvent, SerialisedResource } from "../../src/index";
import { instant, testScope } from "../support/feed";
import { testInstallation, testOptions } from "../support/options";

const uid = (value: string) => ({ kind: "eventUid", value }) as const;

const berlinSeries = (year: number, zone: string): CanonicalEvent => ({
  identity: { kind: "master", uid: uid("evt-series") },
  content: {
    title: "weekly sync",
    description: null,
    location: null,
    availability: "busy",
    visibility: "default",
    recurrence: { dialect: "rfc5545", value: "FREQ=WEEKLY;COUNT=6", exceptions: [] },
    anchor: {
      kind: "timed",
      start: instant(`${year}-03-02T09:00:00.000Z`),
      zone: { kind: "zoneId", value: zone },
      duration: { kind: "exact", seconds: 3600 },
    },
  },
  cancellations: [],
});

const allDaySeries: CanonicalEvent = {
  identity: { kind: "master", uid: uid("evt-all-day") },
  content: {
    title: "public holiday",
    description: null,
    location: null,
    availability: "busy",
    visibility: "default",
    recurrence: {
      dialect: "rfc5545",
      value: "FREQ=YEARLY;COUNT=4",
      exceptions: ["20260312T000000Z"],
    },
    anchor: {
      kind: "allDay",
      startDate: { kind: "calendarDate", value: "2026-03-10" },
      duration: { kind: "nominal", days: 1 },
    },
  },
  cancellations: [],
};

const textOf = (resource: SerialisedResource): string => {
  if (resource.kind !== "resource") {
    return "";
  }
  return resource.text;
};

const serialise = (event: CanonicalEvent) =>
  serialiseCalendarResource({ master: event, overrides: [], sequence: 0 }, testOptions());

describe("what we actually write back to a real calendar", () => {
  test("ICAL-O52: the VTIMEZONE covers the year the event itself occurs in", () => {
    const text = textOf(serialise(berlinSeries(2019, "Europe/Berlin")));

    expect(text).toContain("BEGIN:VTIMEZONE");
    expect(text).toContain("DTSTART:2019");
  });

  test("ICAL-O53: a Windows identifier is written as the same zone the VTIMEZONE declares", () => {
    const text = textOf(serialise(berlinSeries(2026, "W. Europe Standard Time")));

    expect(text).toContain("TZID:Europe/Berlin");
    expect(text).not.toContain("TZID=W. Europe Standard Time");
  });

  test("ICAL-O53: an identifier we cannot resolve refuses the write instead of substituting UTC", () => {
    expect(serialise(berlinSeries(2026, "Middle-earth/Shire"))).toEqual({
      kind: "refused",
      constraint: "zoneIdentifier",
    });
  });

  test("ICAL-O54: an all-day EXDATE is written as a DATE value, matching its DTSTART", () => {
    const text = textOf(serialise(allDaySeries));

    expect(text).toContain("EXDATE;VALUE=DATE:20260312");
    expect(text).not.toContain("EXDATE:20260312T000000Z");
  });

  test("ICAL-O55: a resource we write is recognised as ours when it comes back in a feed", () => {
    const text = textOf(serialise(berlinSeries(2026, "Europe/Berlin")));
    const projection = projectIcsFeed({
      body: text,
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(text).toContain(`X-KEEPER-INSTALLATION:${testInstallation.value}`);
    expect(projection.value.listing.diagnostics.selfAuthored.total).toBe(1);
    expect(projection.value.usable).toEqual([]);
  });
});
