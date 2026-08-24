import { describe, expect, it } from "vitest";
import { planCalendarRediscovery } from "../../../src/core/source/calendar-rediscovery";
import type {
  CalendarRediscoveryPlan,
  DiscoveredCalendar,
  ExistingCalendar,
} from "../../../src/core/source/calendar-rediscovery";

const PLAN_KEYS = [
  "crossAccountSkippedCount",
  "duplicateCount",
  "removedSkippedCount",
  "suppressed",
  "toInsert",
  "toMarkUnavailable",
  "toRetargetUrl",
  "toRevive",
  "unchangedCount",
];

const discovered = (overrides: Partial<DiscoveredCalendar> = {}): DiscoveredCalendar => ({
  calendarUrl: null,
  externalCalendarId: "external-1",
  identityKey: "external-1",
  name: "Work",
  writable: true,
  ...overrides,
});

const existing = (overrides: Partial<ExistingCalendar> = {}): ExistingCalendar => ({
  calendarUrl: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  id: "calendar-1",
  identityKey: "external-1",
  unavailableSince: null,
  ...overrides,
});

const pathKey = (calendarUrl: string): string =>
  decodeURIComponent(new URL(calendarUrl).pathname).replace(/\/+$/u, "");

const caldavExisting = (
  id: string,
  calendarUrl: string,
  overrides: Partial<ExistingCalendar> = {},
): ExistingCalendar => existing({
  calendarUrl,
  id,
  identityKey: pathKey(calendarUrl),
  ...overrides,
});

const caldavDiscovered = (calendarUrl: string, name = "Work"): DiscoveredCalendar => discovered({
  calendarUrl,
  externalCalendarId: null,
  identityKey: pathKey(calendarUrl),
  name,
});

describe("planCalendarRediscovery", () => {
  it("adds only calendars the provider returned that have no row yet", () => {
    const plan = planCalendarRediscovery({
      discovered: [
        discovered({ externalCalendarId: "external-1", identityKey: "external-1", name: "Work" }),
        discovered({ externalCalendarId: "external-2", identityKey: "external-2", name: "Personal" }),
        discovered({ externalCalendarId: "external-3", identityKey: "external-3", name: "Shared" }),
      ],
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({ id: "calendar-2", identityKey: "external-2" }),
      ],
    });

    expect(plan.toInsert.map(({ identityKey }) => identityKey)).toEqual(["external-3"]);
    expect(plan.unchangedCount).toBe(2);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(plan.toRevive).toEqual([]);
    expect(plan.suppressed).toBe(false);
  });

  it("cannot express deleting a calendar row", () => {
    const plan: CalendarRediscoveryPlan = planCalendarRediscovery({
      discovered: [discovered({ identityKey: "external-2", externalCalendarId: "external-2" })],
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({ id: "calendar-2", identityKey: "external-2" }),
      ],
    });

    expect(Object.keys(plan).toSorted()).toEqual(PLAN_KEYS);
    expect(Object.keys(plan)).not.toContain("inserted");
    expect(JSON.stringify(plan).toLowerCase()).not.toContain("delete");
    expect(Object.keys(plan).filter((key) => (/^to(?:Delete|Remove)/u).test(key))).toEqual([]);

    const touched = [
      ...plan.toRevive,
      ...plan.toMarkUnavailable,
      ...plan.toRetargetUrl.map(({ id }) => id),
    ];
    expect(touched.length).toBe(new Set(touched).size);
  });

  it("leaves a provider-side rename alone so a user rename survives", () => {
    const plan = planCalendarRediscovery({
      discovered: [discovered({ name: "Renamed On The Server" })],
      existing: [existing({ id: "calendar-1" })],
    });

    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("Renamed On The Server");
    expect(JSON.stringify(plan)).not.toContain("name");
  });

  it("matches a CalDAV calendar through host and port drift and retargets the stored URL", () => {
    const plan = planCalendarRediscovery({
      discovered: [caldavDiscovered("http://cloud.example.com:8080/dav/bob/work")],
      existing: [caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/work/")],
    });

    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(plan.toRetargetUrl).toEqual([
      { calendarUrl: "http://cloud.example.com:8080/dav/bob/work", id: "calendar-1" },
    ]);
  });

  it("matches through trailing slash and percent encoding drift", () => {
    const trailingSlash = planCalendarRediscovery({
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/work")],
      existing: [caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/work/")],
    });

    expect(trailingSlash.toInsert).toEqual([]);
    expect(trailingSlash.toMarkUnavailable).toEqual([]);

    const encoded = planCalendarRediscovery({
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/My%20Work")],
      existing: [{
        calendarUrl: "https://cloud.example.com/dav/bob/My Work",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: "calendar-1",
        identityKey: "/dav/bob/My Work",
        unavailableSince: null,
      }],
    });

    expect(encoded.toInsert).toEqual([]);
    expect(encoded.toMarkUnavailable).toEqual([]);
  });

  it("reinstates a calendar that reappears without touching pause or backoff state", () => {
    const plan = planCalendarRediscovery({
      discovered: [discovered()],
      existing: [existing({
        id: "calendar-1",
        unavailableSince: new Date("2026-07-01T00:00:00.000Z"),
      })],
    });

    expect(plan.toRevive).toEqual(["calendar-1"]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);

    const serialized = JSON.stringify(plan);
    for (const forbidden of [
      "disabled",
      "failureCount",
      "lastFailureAt",
      "nextAttemptAt",
      "ingestFailureCount",
      "ingestLastFailureAt",
      "ingestNextAttemptAt",
      "capabilities",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("marks a calendar the provider stopped returning instead of deleting it", () => {
    const plan = planCalendarRediscovery({
      discovered: [discovered({ externalCalendarId: "external-1", identityKey: "external-1" })],
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({ id: "calendar-2", identityKey: "external-2" }),
      ],
    });

    expect(plan.toMarkUnavailable).toEqual(["calendar-2"]);
    expect(plan.toInsert).toEqual([]);
  });

  it("stamps unavailability once and never re-stamps a still-missing calendar", () => {
    const plan = planCalendarRediscovery({
      discovered: [discovered({ externalCalendarId: "external-1", identityKey: "external-1" })],
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({
          id: "calendar-2",
          identityKey: "external-2",
          unavailableSince: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ],
    });

    expect(plan.toMarkUnavailable).toEqual([]);
  });

  it("never marks a calendar connected after the enumeration started", () => {
    const enumerationStartedAt = new Date("2026-08-12T10:00:00.000Z");

    const plan = planCalendarRediscovery({
      discovered: [discovered({ externalCalendarId: "external-1", identityKey: "external-1" })],
      enumerationStartedAt,
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({
          createdAt: new Date("2026-08-12T10:00:01.000Z"),
          id: "calendar-2",
          identityKey: "external-2",
        }),
      ],
    });

    expect(plan.toMarkUnavailable).toEqual([]);
  });

  it("still marks a calendar that predates the enumeration", () => {
    const enumerationStartedAt = new Date("2026-08-12T10:00:00.000Z");

    const plan = planCalendarRediscovery({
      discovered: [discovered({ externalCalendarId: "external-1", identityKey: "external-1" })],
      enumerationStartedAt,
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({
          createdAt: new Date("2026-08-12T09:59:59.000Z"),
          id: "calendar-2",
          identityKey: "external-2",
        }),
      ],
    });

    expect(plan.toMarkUnavailable).toEqual(["calendar-2"]);
  });

  it("suppresses an empty enumeration instead of marking every calendar unavailable", () => {
    const plan = planCalendarRediscovery({
      discovered: [],
      existing: [
        existing({ id: "calendar-1", identityKey: "external-1" }),
        existing({ id: "calendar-2", identityKey: "external-2" }),
      ],
    });

    expect(plan.suppressed).toBe(true);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toRevive).toEqual([]);
    expect(plan.toRetargetUrl).toEqual([]);
  });

  it("does not suppress an empty enumeration for an account with no calendars", () => {
    const plan = planCalendarRediscovery({ discovered: [], existing: [] });

    expect(plan.suppressed).toBe(false);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);
  });

  it("resolves pre-existing duplicate rows by keeping the oldest and touching neither", () => {
    const plan = planCalendarRediscovery({
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/work")],
      existing: [
        caldavExisting("calendar-new", "https://cloud.example.com/dav/bob/work", {
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        }),
        caldavExisting("calendar-old", "https://cloud.example.com/dav/bob/work/", {
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
    });

    expect(plan.duplicateCount).toBe(1);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(plan.toRevive).toEqual([]);
    expect(plan.toRetargetUrl.map(({ id }) => id)).not.toContain("calendar-new");
  });

  it("skips a calendar already connected under another account of the same user", () => {
    const plan = planCalendarRediscovery({
      blockedKeys: new Set(["/dav/bob/shared"]),
      discovered: [
        caldavDiscovered("https://cloud.example.com/dav/bob/shared", "Shared"),
        caldavDiscovered("https://cloud.example.com/dav/bob/work", "Work"),
      ],
      existing: [],
    });

    expect(plan.toInsert.map(({ identityKey }) => identityKey)).toEqual(["/dav/bob/work"]);
    expect(plan.crossAccountSkippedCount).toBe(1);
    expect(plan.toMarkUnavailable).toEqual([]);
  });

  it("treats a blocked key that this account already owns as an ordinary match", () => {
    const plan = planCalendarRediscovery({
      blockedKeys: new Set(["/dav/bob/shared"]),
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/shared", "Shared")],
      existing: [caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/shared")],
    });

    expect(plan.crossAccountSkippedCount).toBe(0);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMarkUnavailable).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
  });

  it("revives a blocked key that this account already owns rather than skipping it", () => {
    const plan = planCalendarRediscovery({
      blockedKeys: new Set(["/dav/bob/shared"]),
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/shared", "Shared")],
      existing: [
        caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/shared", {
          unavailableSince: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ],
    });

    expect(plan.toRevive).toEqual(["calendar-1"]);
    expect(plan.crossAccountSkippedCount).toBe(0);
  });

  it("changes nothing when the blocked key set is empty", () => {
    const input = {
      discovered: [caldavDiscovered("https://cloud.example.com/dav/bob/work", "Work")],
      existing: [],
    };

    const withoutBlocked = planCalendarRediscovery(input);
    const withEmptyBlocked = planCalendarRediscovery({
      ...input,
      blockedKeys: new Set<string>(),
    });

    expect(withEmptyBlocked).toEqual(withoutBlocked);
    expect(withEmptyBlocked.crossAccountSkippedCount).toBe(0);
    expect(withEmptyBlocked.toInsert).toHaveLength(1);
  });

  it("is idempotent once the plan has been applied", () => {
    const first = planCalendarRediscovery({
      discovered: [
        caldavDiscovered("http://cloud.example.com:8080/dav/bob/work"),
        caldavDiscovered("http://cloud.example.com:8080/dav/bob/new", "New"),
      ],
      existing: [
        caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/work/", {
          unavailableSince: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ],
    });

    expect(first.toInsert).toHaveLength(1);
    expect(first.toRevive).toEqual(["calendar-1"]);
    expect(first.toRetargetUrl).toHaveLength(1);

    const second = planCalendarRediscovery({
      discovered: [
        caldavDiscovered("http://cloud.example.com:8080/dav/bob/work"),
        caldavDiscovered("http://cloud.example.com:8080/dav/bob/new", "New"),
      ],
      existing: [
        caldavExisting("calendar-1", "http://cloud.example.com:8080/dav/bob/work"),
        caldavExisting("calendar-2", "http://cloud.example.com:8080/dav/bob/new"),
      ],
    });

    expect(second.toInsert).toEqual([]);
    expect(second.toMarkUnavailable).toEqual([]);
    expect(second.toRetargetUrl).toEqual([]);
    expect(second.toRevive).toEqual([]);
    expect(second.unchangedCount).toBe(2);
  });

  it("collapses discovered entries that normalize to the same calendar", () => {
    const plan = planCalendarRediscovery({
      discovered: [
        caldavDiscovered("https://cloud.example.com/dav/bob/work", "Work"),
        caldavDiscovered("https://cloud.example.com/dav/bob/work/", "Work"),
        caldavDiscovered("https://cloud.example.com/dav/bob/My%20Work", "My Work"),
        caldavDiscovered("https://cloud.example.com/dav/bob/My Work", "My Work"),
      ],
      existing: [],
    });

    expect(plan.toInsert.map(({ calendarUrl }) => calendarUrl)).toEqual([
      "https://cloud.example.com/dav/bob/work",
      "https://cloud.example.com/dav/bob/My%20Work",
    ]);
    expect(plan.duplicateCount).toBe(2);
  });

  it("counts a repeated discovery of an existing calendar only once", () => {
    const plan = planCalendarRediscovery({
      discovered: [
        caldavDiscovered("https://cloud.example.com/dav/bob/work"),
        caldavDiscovered("https://cloud.example.com/dav/bob/work/"),
      ],
      existing: [caldavExisting("calendar-1", "https://cloud.example.com/dav/bob/work")],
    });

    expect(plan.unchangedCount).toBe(1);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toRetargetUrl).toEqual([]);
    expect(plan.duplicateCount).toBe(1);
  });
});
