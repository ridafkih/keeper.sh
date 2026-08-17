import { describe, expect, test } from "vitest";
import { projectCanonicalEvent, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const master = (extra: readonly string[] = []): readonly string[] =>
  vevent({
    uid: "evt-series",
    lines: [
      "DTSTAMP:20260301T080000Z",
      "DTSTART:20260302T090000Z",
      "DTEND:20260302T100000Z",
      "RRULE:FREQ=WEEKLY;COUNT=6",
      "SUMMARY:weekly sync",
      ...extra,
    ],
  });

const cancelledOverride = vevent({
  uid: "evt-series",
  lines: [
    "DTSTAMP:20260305T080000Z",
    "RECURRENCE-ID:20260309T090000Z",
    "DTSTART:20260309T090000Z",
    "DTEND:20260309T100000Z",
    "STATUS:CANCELLED",
    "SUMMARY:weekly sync",
  ],
});

const detachedOverride = vevent({
  uid: "evt-series",
  lines: [
    "DTSTAMP:20260305T080000Z",
    "RECURRENCE-ID:20260316T090000Z",
    "DTSTART:20260316T113000Z",
    "DTEND:20260316T123000Z",
    "SUMMARY:weekly sync moved",
  ],
});

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("STATUS:CANCELLED", () => {
  test("ICAL-O23: a cancelled RECURRENCE-ID override becomes a master exception at the exact instant", () => {
    const projection = project(calendarWith([...master(), ...cancelledOverride]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [survivor] = projection.value.listing.events;
    expect(survivor).toBeDefined();
    if (!survivor) {
      return;
    }
    expect(survivor.content.recurrence).not.toBeNull();
    expect(survivor.content.recurrence?.exceptions).toEqual(["20260309T090000Z"]);
  });

  test("ICAL-O23: the cancelled day cannot reappear from an RRULE expansion", () => {
    const projection = project(calendarWith([...master(), ...cancelledOverride]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toHaveLength(1);
    expect(projection.value.usable.map((identity) => identity.kind)).toEqual(["master"]);
  });

  test("ICAL-O24: a cancelled master drops its detached overrides", () => {
    const projection = project(
      calendarWith([...master(["STATUS:CANCELLED"]), ...detachedOverride]),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toEqual([]);
    expect(projection.value.present.map((identity) => identity.uid.value)).toContain("evt-series");
  });

  test("ICAL-O24: a newer revision un-cancels the series", () => {
    const cancelledFirst = vevent({
      uid: "evt-series",
      lines: [
        "SEQUENCE:1",
        "DTSTAMP:20260301T080000Z",
        "DTSTART:20260302T090000Z",
        "DTEND:20260302T100000Z",
        "STATUS:CANCELLED",
        "SUMMARY:weekly sync",
      ],
    });
    const restored = vevent({
      uid: "evt-series",
      lines: [
        "SEQUENCE:2",
        "DTSTAMP:20260306T080000Z",
        "DTSTART:20260302T090000Z",
        "DTEND:20260302T100000Z",
        "STATUS:CONFIRMED",
        "SUMMARY:weekly sync",
      ],
    });
    const projection = project(calendarWith([...cancelledFirst, ...restored]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toHaveLength(1);
  });

  test("ICAL-I9: cancellations reach the canonical projection as a value, not as an absence", () => {
    const projection = project(calendarWith([...master(), ...cancelledOverride]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [survivor] = projection.value.listing.events;
    expect(survivor).toBeDefined();
    if (!survivor) {
      return;
    }
    const canonical = projectCanonicalEvent({
      identity: { kind: "master", uid: survivor.uid },
      content: survivor.content,
      revision: { sequence: null, lastModified: null, stamp: null, created: null },
      cancelled: false,
      provenance: { kind: "foreign" },
    });

    expect(canonical.cancellations.map((instant) => instant.value)).toEqual([
      "2026-03-09T09:00:00.000Z",
    ]);
  });
});
