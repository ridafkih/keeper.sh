import { describe, expect, test } from "vitest";
import { eventIdentityKey, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const unversionedSlot = (start: string, end: string): readonly string[] =>
  vevent({
    uid: "evt-shared",
    lines: [`DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`, "SUMMARY:office hours"],
  });

const versionedMaster = vevent({
  uid: "evt-shared",
  lines: [
    "SEQUENCE:3",
    "DTSTAMP:20260312T080000Z",
    "DTSTART:20260312T090000Z",
    "DTEND:20260312T100000Z",
    "RRULE:FREQ=WEEKLY;COUNT=4",
    "SUMMARY:office hours",
  ],
});

const feed = calendarWith([
  ...unversionedSlot("20260310T090000Z", "20260310T100000Z"),
  ...unversionedSlot("20260311T090000Z", "20260311T100000Z"),
  ...versionedMaster,
]);

const project = () =>
  projectIcsFeed({
    body: feed,
    scope: testScope,
    previousContentHash: null,
    options: testOptions(),
  });

describe("two genuinely distinct events a publisher gave one UID", () => {
  test("ICAL-O8: a later versioned master does not resurrect an unversioned slot", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const keys = projection.value.present.map((identity) => eventIdentityKey(identity));
    expect(new Set(keys).size).toBe(3);
    expect(projection.value.usable).toHaveLength(1);
  });

  test("ICAL-O8: the two slots are superseded, not merged into the master's row", () => {
    const projection = project();

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const kinds = projection.value.present.map((identity) => identity.kind).toSorted();
    expect(kinds).toEqual(["master", "slot", "slot"]);
    expect(projection.value.usable.map((identity) => identity.kind)).toEqual(["master"]);
  });

  test("ICAL-I8: the identity key is derived from the three-member union, never sniffed from a UID string", () => {
    const masterKey = eventIdentityKey({
      kind: "master",
      uid: { kind: "eventUid", value: "evt-shared" },
    });
    const slotKey = eventIdentityKey({
      kind: "slot",
      uid: { kind: "eventUid", value: "evt-shared" },
      start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" },
    });
    const overrideKey = eventIdentityKey({
      kind: "override",
      uid: { kind: "eventUid", value: "evt-shared" },
      recurrenceInstant: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
    });

    expect(new Set([masterKey, slotKey, overrideKey]).size).toBe(3);
  });

  test("ICAL-I8: a UID that literally contains the slot separator does not collide with a real slot", () => {
    const spoofed = eventIdentityKey({
      kind: "master",
      uid: { kind: "eventUid", value: "evt|slot|2026-03-10T09:00:00.000Z" },
    });
    const genuine = eventIdentityKey({
      kind: "slot",
      uid: { kind: "eventUid", value: "evt" },
      start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" },
    });

    expect(spoofed).not.toBe(genuine);
  });
});
