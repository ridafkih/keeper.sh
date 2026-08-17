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

const cancelledMaster = vevent({
  uid: "evt-cancelled",
  lines: [
    "DTSTAMP:20260301T080000Z",
    "DTSTART:20260302T090000Z",
    "DTEND:20260302T100000Z",
    "STATUS:CANCELLED",
    "SUMMARY:called off",
  ],
});

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("everything a snapshot says is present", () => {
  test("ICAL-O50: two distinct unversioned slots both survive rather than one silently winning", () => {
    const projection = project(
      calendarWith([
        ...unversionedSlot("20260310T090000Z", "20260310T100000Z"),
        ...unversionedSlot("20260311T090000Z", "20260311T100000Z"),
      ]),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.events).toHaveLength(2);
    expect(new Set(projection.value.usable.map((identity) => eventIdentityKey(identity))).size).toBe(
      2,
    );
  });

  test("ICAL-O50: a slot a versioned master supersedes is named on the listing, not merely absent", () => {
    const projection = project(
      calendarWith([...unversionedSlot("20260310T090000Z", "20260310T100000Z"), ...versionedMaster]),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.events).toHaveLength(1);
    expect(projection.value.listing.withheld.map((entry) => entry.reason)).toEqual([
      "supersededRevisionUnbuildable",
    ]);
  });

  test("ICAL-O51: a cancelled event reaches the listing as a removal, never as a silent absence", () => {
    const projection = project(calendarWith([...cancelledMaster]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.events).toEqual([]);
    expect(projection.value.listing.removals).toEqual([
      expect.objectContaining({
        kind: "cancelled",
        uid: { kind: "eventUid", value: "evt-cancelled" },
      }),
    ]);
  });

  test("ICAL-O51: every present identity is an event, a removal or a withheld entry", () => {
    const projection = project(
      calendarWith([
        ...cancelledMaster,
        ...unversionedSlot("20260310T090000Z", "20260310T100000Z"),
        ...versionedMaster,
      ]),
    );

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const named = new Set([
      ...projection.value.listing.events.map((event) => event.id.value),
      ...projection.value.listing.removals.map((removal) => removal.id.value),
      ...projection.value.listing.withheld.flatMap((entry) => {
        if (!entry.id) {
          return [];
        }
        return [entry.id.value];
      }),
    ]);

    for (const identity of projection.value.present) {
      expect(`${eventIdentityKey(identity)}:${named.has(eventIdentityKey(identity))}`).toBe(
        `${eventIdentityKey(identity)}:true`,
      );
    }
  });
});
