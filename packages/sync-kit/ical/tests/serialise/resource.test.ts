import { describe, expect, test } from "vitest";
import { serialiseCalendarResource } from "../../src/index";
import type { CanonicalEvent } from "../../src/index";
import { instant } from "../support/feed";
import { testOptions } from "../support/options";

const uid = (value: string) => ({ kind: "eventUid", value }) as const;

const master: CanonicalEvent = {
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
      start: instant("2026-03-02T09:00:00.000Z"),
      zone: { kind: "zoneId", value: "Europe/Berlin" },
      duration: { kind: "exact", seconds: 3600 },
    },
  },
  cancellations: [],
};

const overrideWith = (overrideUid: string): CanonicalEvent => ({
  identity: {
    kind: "override",
    uid: uid(overrideUid),
    recurrenceInstant: instant("2026-03-16T09:00:00.000Z"),
  },
  content: {
    title: "weekly sync moved",
    description: null,
    location: null,
    availability: "busy",
    visibility: "default",
    recurrence: null,
    time: {
      kind: "timed",
      start: instant("2026-03-16T10:30:00.000Z"),
      end: instant("2026-03-16T11:30:00.000Z"),
      zone: { kind: "zoneId", value: "Europe/Berlin" },
    },
  },
  cancellations: [],
});

describe("serialising a recurrence set into one calendar object resource", () => {
  test("ICAL-O37: an override carrying a different UID is refused, never written", () => {
    expect(
      serialiseCalendarResource(
        { master, overrides: [overrideWith("evt-other")] },
        testOptions(),
      ),
    ).toEqual({
      kind: "uidMismatch",
      master: uid("evt-series"),
      override: uid("evt-other"),
    });
  });

  test("RFC 4791 §4.1: a set serialises to one master and N overrides sharing one UID", () => {
    const serialised = serialiseCalendarResource(
      { master, overrides: [overrideWith("evt-series")] },
      testOptions(),
    );

    expect(serialised.kind).toBe("resource");
    if (serialised.kind !== "resource") {
      return;
    }
    const uidLines = serialised.text.split("\r\n").filter((line) => line.startsWith("UID:"));
    expect(uidLines).toEqual(["UID:evt-series", "UID:evt-series"]);
    expect(serialised.text.split("BEGIN:VEVENT")).toHaveLength(3);
  });

  test("RFC 4791 §4.1: a VTIMEZONE is emitted for each unique TZID the resource uses", () => {
    const serialised = serialiseCalendarResource(
      { master, overrides: [overrideWith("evt-series")] },
      testOptions(),
    );

    expect(serialised.kind).toBe("resource");
    if (serialised.kind !== "resource") {
      return;
    }
    expect(serialised.zones.map((zone) => zone.value)).toEqual(["Europe/Berlin"]);
    expect(serialised.text.split("BEGIN:VTIMEZONE")).toHaveLength(2);
  });

  test("ICAL-O37: an unrepresentable master is refused with a typed constraint", () => {
    const inverted: CanonicalEvent = {
      ...master,
      content: {
        title: "inverted",
        description: null,
        location: null,
        availability: "busy",
        visibility: "default",
        recurrence: null,
        time: {
          kind: "timed",
          start: instant("2026-03-16T11:30:00.000Z"),
          end: instant("2026-03-16T10:30:00.000Z"),
          zone: null,
        },
      },
    };

    expect(serialiseCalendarResource({ master: inverted, overrides: [] }, testOptions())).toEqual({
      kind: "refused",
      constraint: "invertedRange",
    });
  });

  test("ICAL-I40: a master with no overrides is still one resource", () => {
    const serialised = serialiseCalendarResource({ master, overrides: [] }, testOptions());

    expect(serialised.kind).toBe("resource");
    if (serialised.kind !== "resource") {
      return;
    }
    expect(serialised.text.split("BEGIN:VEVENT")).toHaveLength(2);
  });
});
