import { describe, expect, test } from "vitest";
import {
  canonicalEventFingerprint,
  canonicalFieldOrder,
  encodeCanonicalEvent,
  parseStoredCanonicalEvent,
  serialiseCalendarResource,
} from "../../src/index";
import { calendarWith, vevent } from "../support/feed";
import { canonicalEventsOf, fingerprintsOf, soleFingerprint } from "../support/canonical";
import { testOptions } from "../support/options";

const eventA = vevent({
  uid: "evt-a",
  lines: [
    "DTSTAMP:20260101T000000Z",
    "DTSTART:20260310T090000Z",
    "DTEND:20260310T100000Z",
    "SUMMARY:a",
  ],
});

const eventB = vevent({
  uid: "evt-b",
  lines: [
    "DTSTAMP:20260101T000000Z",
    "DTSTART:20260311T090000Z",
    "DTEND:20260311T100000Z",
    "SUMMARY:b",
  ],
});

const recurringWithExceptions = (exceptions: readonly string[]): string =>
  calendarWith([
    ...vevent({
      uid: "evt-series",
      lines: [
        "DTSTAMP:20260101T000000Z",
        "DTSTART:20260302T090000Z",
        "DTEND:20260302T100000Z",
        "RRULE:FREQ=WEEKLY;COUNT=8",
        `EXDATE:${exceptions.join(",")}`,
        "SUMMARY:series",
      ],
    }),
  ]);

const sortedFingerprints = (body: string): readonly string[] => [...fingerprintsOf(body)].toSorted();

const reorderedKeys = (value: unknown): unknown => structuredClone(value);

describe("what the fingerprint deliberately cannot see", () => {
  test("ICAL-O18: VEVENT order does not change the set of fingerprints", () => {
    expect(sortedFingerprints(calendarWith([...eventA, ...eventB]))).toEqual(
      sortedFingerprints(calendarWith([...eventB, ...eventA])),
    );
    expect(sortedFingerprints(calendarWith([...eventA, ...eventB]))).toHaveLength(2);
  });

  test("ICAL-O18: exception-date order does not change the fingerprint", () => {
    const ascending = recurringWithExceptions(["20260309T090000Z", "20260316T090000Z"]);
    const descending = recurringWithExceptions(["20260316T090000Z", "20260309T090000Z"]);

    expect(soleFingerprint(descending)).toBe(soleFingerprint(ascending));
  });

  test("ICAL-O18: a duplicated exception date does not change the fingerprint", () => {
    const once = recurringWithExceptions(["20260309T090000Z"]);
    const twice = recurringWithExceptions(["20260309T090000Z", "20260309T090000Z"]);

    expect(soleFingerprint(twice)).toBe(soleFingerprint(once));
  });

  test("ICAL-O18: object key order in a stored canonical event does not change the fingerprint", () => {
    const [canonical] = canonicalEventsOf(calendarWith([...eventA]));
    expect(canonical).toBeDefined();
    if (!canonical) {
      return;
    }
    const reordered = parseStoredCanonicalEvent(
      reorderedKeys({
        cancellations: canonical.cancellations,
        content: canonical.content,
        identity: canonical.identity,
      }),
    );

    expect(canonicalEventFingerprint(reordered).value).toBe(
      canonicalEventFingerprint(canonical).value,
    );
  });

  test("ICAL-O20: hashing the canonical form twice is a fixed point through serialise and reparse", () => {
    const [canonical] = canonicalEventsOf(calendarWith([...eventA]));
    expect(canonical).toBeDefined();
    if (!canonical) {
      return;
    }
    const serialised = serialiseCalendarResource(
      { master: canonical, overrides: [] },
      testOptions(),
    );
    expect(serialised.kind).toBe("resource");
    if (serialised.kind !== "resource") {
      return;
    }
    expect(
      soleFingerprint(serialised.text, testOptions({ selfAuthored: "includeForRoundTrip" })),
    ).toBe(canonicalEventFingerprint(canonical).value);
  });

  test("ICAL-I33: the encoding is one field per canonical slot, with a separator no value can contain", () => {
    const [canonical] = canonicalEventsOf(calendarWith([...eventA]));
    expect(canonical).toBeDefined();
    if (!canonical) {
      return;
    }
    const fieldSeparator = String.fromCodePoint(0);
    const absentSentinel = String.fromCodePoint(1);
    const encoded = encodeCanonicalEvent(canonical);

    expect(encoded.split(fieldSeparator)).toHaveLength(canonicalFieldOrder.length);
    expect(encoded.split(fieldSeparator)).toContain(absentSentinel);
  });
});
