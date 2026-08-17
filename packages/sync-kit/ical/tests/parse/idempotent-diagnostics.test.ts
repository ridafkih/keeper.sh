import { describe, expect, test } from "vitest";
import { eventIdentityKey, projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const malformedFeed = calendarWith([
  ...simpleEvent("evt-healthy", "20260310T090000Z", "20260310T100000Z"),
  ...vevent({
    uid: "evt-negative",
    lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20260310T090000Z", "DURATION:-PT1H"],
  }),
  ...vevent({
    uid: "evt-no-start",
    lines: ["DTSTAMP:20260310T080000Z", "SUMMARY:no start"],
  }),
]);

const project = () =>
  projectIcsFeed({
    body: malformedFeed,
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });

describe("polling the same malformed feed twice", () => {
  test("ICAL-O22: the second poll reports identical diagnostics", () => {
    const first = project();
    const second = project();

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.listing.diagnostics).toEqual(first.value.listing.diagnostics);
    expect(second.value.unsupported).toEqual(first.value.unsupported);
  });

  test("ICAL-O22: the second poll produces an empty diff against the first", () => {
    const first = project();
    const second = project();

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    const firstFingerprints = first.value.listing.events.map((event) => event.fingerprint.value);
    const secondFingerprints = second.value.listing.events.map((event) => event.fingerprint.value);
    expect(secondFingerprints).toEqual(firstFingerprints);
  });

  test("ICAL-I5: diagnostics are keyed on the event identity, not counted per VEVENT occurrence", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const withheldKeys = projection.value.listing.diagnostics.withheld.sample;
    expect(new Set(withheldKeys).size).toBe(withheldKeys.length);
    const presentKeys = projection.value.present.map((identity) => eventIdentityKey(identity));
    expect(new Set(presentKeys).size).toBe(presentKeys.length);
  });

  test("ICAL-I5: repeating the identical malformed VEVENT does not inflate the total", () => {
    const doubled = projectIcsFeed({
      body: calendarWith([
        ...vevent({
          uid: "evt-negative",
          lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20260310T090000Z", "DURATION:-PT1H"],
        }),
        ...vevent({
          uid: "evt-negative",
          lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20260310T090000Z", "DURATION:-PT1H"],
        }),
      ]),
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(doubled.ok).toBe(true);
    if (!doubled.ok) {
      return;
    }
    expect(doubled.value.listing.diagnostics.withheld.total).toBe(1);
  });
});
