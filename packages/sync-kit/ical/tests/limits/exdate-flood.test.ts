import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const maxExceptionDates = 32;

const exceptionDates = (count: number): string =>
  Array.from({ length: count }, (_unused, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, "0");
    const year = 2026 + Math.floor(index / 336);
    return `${year}${month}${day}T090000Z`;
  }).join(",");

const floodedEvent = (count: number): readonly string[] =>
  vevent({
    uid: "evt-flooded",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260101T090000Z",
      "DTEND:20260101T100000Z",
      "RRULE:FREQ=DAILY;COUNT=2000",
      `EXDATE:${exceptionDates(count)}`,
      "SUMMARY:flooded",
    ],
  });

const project = (count: number) =>
  projectIcsFeed({
    body: calendarWith([
      ...simpleEvent("evt-healthy-a", "20260310T090000Z", "20260310T100000Z"),
      ...floodedEvent(count),
      ...simpleEvent("evt-healthy-b", "20260311T090000Z", "20260311T100000Z"),
    ]),
    scope: testScope,
    previousContentHash: null,
    options: testOptions({ limits: { maxExceptionDates } }),
  });

describe("one pathological event's exception list", () => {
  test("ICAL-L3: more EXDATEs than maxExceptionDates yields a single withheld outcome, not an expansion", () => {
    const projection = project(maxExceptionDates + 1);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "recurrenceBudgetExceeded" }),
    ]);
  });

  test("ICAL-L3: the withheld event is not a silent drop, so its stored row survives", () => {
    const projection = project(maxExceptionDates + 1);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present.map((identity) => identity.uid.value)).toContain(
      "evt-flooded",
    );
  });

  test("ICAL-L3: both healthy events beside it still project", () => {
    const projection = project(maxExceptionDates + 1);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value).toSorted()).toEqual([
      "evt-healthy-a",
      "evt-healthy-b",
    ]);
  });

  test("ICAL-L3: an event exactly at the ceiling is still built", () => {
    const projection = project(maxExceptionDates);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toContain("evt-flooded");
  });

  test(
    "ICAL-L3: a flood three orders of magnitude over the ceiling withholds exactly as the ceiling does",
    () => {
      const projection = project(100_000);

      expect(projection.ok).toBe(true);
      if (!projection.ok) {
        return;
      }
      expect(projection.value.unsupported).toEqual([
        expect.objectContaining({ reason: "recurrenceBudgetExceeded" }),
      ]);
      expect(projection.value.usable.map((identity) => identity.uid.value).toSorted()).toEqual([
        "evt-healthy-a",
        "evt-healthy-b",
      ]);
    },
    5000,
  );
});
