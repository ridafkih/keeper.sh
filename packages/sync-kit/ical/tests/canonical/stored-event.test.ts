import { describe, expect, test } from "vitest";
import { IcsInternalDataError, parseStoredCanonicalEvent, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const malformedStoredPayloads = [
  { name: "a null payload", value: null },
  { name: "a payload with no identity", value: { content: {}, cancellations: [] } },
  {
    name: "a recurring payload whose recurrence went missing",
    value: {
      identity: { kind: "master", uid: { kind: "eventUid", value: "evt-1" } },
      content: { title: "x", description: null, location: null, availability: "busy", visibility: "default", recurrence: null },
      cancellations: [],
    },
  },
  {
    name: "a payload whose cancellations are not instants",
    value: {
      identity: { kind: "master", uid: { kind: "eventUid", value: "evt-1" } },
      content: {
        title: "x",
        description: null,
        location: null,
        availability: "busy",
        visibility: "default",
        recurrence: null,
        time: { kind: "timed", start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" }, end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" }, zone: null },
      },
      cancellations: ["2026-03-17"],
    },
  },
] as const;

describe("data this package produced itself", () => {
  for (const payload of malformedStoredPayloads) {
    test(`ICAL-O41: ${payload.name} throws rather than degrading to a one-off`, () => {
      expect(() => parseStoredCanonicalEvent(payload.value)).toThrow(IcsInternalDataError);
    });
  }

  test("ICAL-O41: the same malformation arriving from a feed is withheld and never throws", () => {
    const feed = calendarWith([
      ...vevent({
        uid: "evt-1",
        lines: ["DTSTAMP:20260101T000000Z", "SUMMARY:no start at all"],
      }),
    ]);

    expect(() =>
      projectIcsFeed({
        body: feed,
        scope: testScope,
        previousContentHash: null,
        options: testOptions(),
      }),
    ).not.toThrow();
    const projection = projectIcsFeed({
      body: feed,
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });
    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.unsupported).toHaveLength(1);
  });

  test("ICAL-I42: the policy split is by input type, never by a leniency flag", () => {
    expect(() => parseStoredCanonicalEvent({})).toThrow(IcsInternalDataError);
    expect(() => parseStoredCanonicalEvent({})).toThrow(Error);
    expect(new IcsInternalDataError("x").name).toBe("IcsInternalDataError");
  });
});
