import { describe, expect, it } from "vitest";
import { calendarQuery, DAVNamespaceShort, fetchCalendarObjects } from "tsdav";
import { buildCalendarObjectFilters } from "../../../../src/providers/caldav/shared/api";

const CALENDAR_URL = "https://caldav.example.com/cal/u/";
const TIME_RANGE = { end: "2028-06-15T00:00:00.000Z", start: "2026-05-15T00:00:00.000Z" };

const recordRequestBodies = (): { bodies: string[]; fetch: typeof fetch } => {
  const bodies: string[] = [];
  const record: typeof globalThis.fetch = Object.assign(
    (_input: string | Request | URL, init?: { body?: unknown }) => {
      if (typeof init?.body !== "string") {
        throw new TypeError("expected tsdav to send a string request body");
      }
      bodies.push(init.body);
      return Promise.resolve(new Response("", { status: 207, statusText: "Multi-Status" }));
    },
    { preconnect: globalThis.fetch.preconnect },
  );

  return { bodies, fetch: record };
};

describe("buildCalendarObjectFilters", () => {
  it("stamps the time range in the CalDAV timestamp format", () => {
    expect(buildCalendarObjectFilters(TIME_RANGE)).toEqual([
      {
        "comp-filter": {
          _attributes: { name: "VCALENDAR" },
          "comp-filter": {
            _attributes: { name: "VEVENT" },
            "time-range": {
              _attributes: { end: "20280615T000000Z", start: "20260515T000000Z" },
            },
          },
        },
      },
    ]);
  });

  it("omits the time range entirely when no range is given", () => {
    expect(buildCalendarObjectFilters()).toEqual([
      {
        "comp-filter": {
          _attributes: { name: "VCALENDAR" },
          "comp-filter": { _attributes: { name: "VEVENT" } },
        },
      },
    ]);
  });
});

describe("our calendar-query body against tsdav's own", () => {
  for (const [label, ranges] of [
    ["without a timeRange", []],
    ["with a timeRange", [TIME_RANGE]],
  ] as const) {
    it(`sends the calendar-query body tsdav sends ${label}`, async () => {
      const [timeRange] = ranges;
      const ours = recordRequestBodies();
      const theirs = recordRequestBodies();

      await calendarQuery({
        depth: "1",
        fetch: ours.fetch,
        filters: buildCalendarObjectFilters(timeRange),
        props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
        url: CALENDAR_URL,
      });
      await fetchCalendarObjects({
        calendar: { url: CALENDAR_URL },
        fetch: theirs.fetch,
        ...(timeRange && { timeRange }),
      });

      expect(ours.bodies).toHaveLength(1);
      expect(ours.bodies[0]).toBe(theirs.bodies[0]);
    });
  }
});
