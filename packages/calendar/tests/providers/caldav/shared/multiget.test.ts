import { describe, expect, it } from "vitest";
import {
  CALDAV_MULTIGET_BATCH_SIZE,
  CalDAVIncompleteMultiGetError,
  buildCalendarObjectFilters,
  findMissingHrefs,
  hasCalendarData,
  orderCalendarObjectsByHref,
  toCalendarObjectPathnames,
  toHrefKey,
} from "../../../../src/providers/caldav/shared/multiget";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";

const CALENDAR_URL = "https://caldav.example.com/cal/u/";

describe("toHrefKey", () => {
  it("resolves a relative href against the calendar url", () => {
    expect(toHrefKey("event.ics", CALENDAR_URL)).toBe("/cal/u/event.ics");
    expect(toHrefKey("/cal/u/event.ics", CALENDAR_URL)).toBe("/cal/u/event.ics");
    expect(toHrefKey(`${CALENDAR_URL}event.ics`, CALENDAR_URL)).toBe("/cal/u/event.ics");
  });

  it("treats a percent-encoded href and its decoded form as the same object", () => {
    expect(toHrefKey("/cal/u/a%20b.ics", CALENDAR_URL))
      .toBe(toHrefKey("/cal/u/a b.ics", CALENDAR_URL));
  });

  it("keeps a segment carrying a malformed escape rather than failing", () => {
    expect(toHrefKey("/cal/u/100%.ics", CALENDAR_URL))
      .toBe(toHrefKey("/cal/u/100%.ics", CALENDAR_URL));
    expect(toHrefKey("/cal/u/100%.ics", CALENDAR_URL))
      .not.toBe(toHrefKey("/cal/u/100.ics", CALENDAR_URL));
  });

  it("does not merge hrefs whose encoded slashes differ from real segments", () => {
    expect(toHrefKey("/cal/u/a%2Fb.ics", CALENDAR_URL))
      .not.toBe(toHrefKey("/cal/u/a/b.ics", CALENDAR_URL));
  });
});

describe("buildCalendarObjectFilters", () => {
  it("stamps the time range in the CalDAV timestamp format", () => {
    expect(buildCalendarObjectFilters({
      end: "2028-06-15T00:00:00.000Z",
      start: "2026-05-15T00:00:00.000Z",
    })).toEqual([
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

describe("toCalendarObjectPathnames", () => {
  it("keeps only calendar objects and reduces them to pathnames", () => {
    expect(toCalendarObjectPathnames(
      [
        { href: "/cal/u/" },
        { href: "/cal/u/notes.txt" },
        { href: "/cal/u/event.ics" },
        { href: "https://caldav.example.com/cal/u/other.ics" },
        {},
      ],
      CALENDAR_URL,
    )).toEqual(["/cal/u/event.ics", "/cal/u/other.ics"]);
  });

  it("drops duplicates while preserving first-seen order", () => {
    expect(toCalendarObjectPathnames(
      [
        { href: "/cal/u/b.ics" },
        { href: "/cal/u/a.ics" },
        { href: `${CALENDAR_URL}b.ics` },
        { href: "/cal/u/a%20b.ics" },
        { href: "/cal/u/a b.ics" },
      ],
      CALENDAR_URL,
    )).toEqual(["/cal/u/b.ics", "/cal/u/a.ics", "/cal/u/a%20b.ics"]);
  });
});

describe("hasCalendarData", () => {
  it("rejects a row whose calendar-data element parsed to an object", () => {
    expect(hasCalendarData({ data: "BEGIN:VCALENDAR" })).toBe(true);
    expect(hasCalendarData({ data: {} })).toBe(false);
    expect(hasCalendarData({})).toBe(false);
  });
});

describe("orderCalendarObjectsByHref", () => {
  it("returns the requested objects in requested order and drops unrequested rows", () => {
    const requested = ["/cal/u/a.ics", "/cal/u/b.ics", "/cal/u/c.ics"];
    const objects = [
      { url: `${CALENDAR_URL}surprise.ics` },
      { url: `${CALENDAR_URL}c.ics` },
      { url: `${CALENDAR_URL}a.ics` },
      { url: `${CALENDAR_URL}b.ics` },
    ];

    expect(orderCalendarObjectsByHref(requested, objects, CALENDAR_URL).map(({ url }) => url))
      .toEqual([`${CALENDAR_URL}a.ics`, `${CALENDAR_URL}b.ics`, `${CALENDAR_URL}c.ics`]);
  });
});

describe("findMissingHrefs", () => {
  it("reports nothing when every requested href came back", () => {
    expect(findMissingHrefs(
      ["/cal/u/a.ics", "/cal/u/a%20b.ics"],
      [{ url: `${CALENDAR_URL}a.ics` }, { url: `${CALENDAR_URL}a b.ics` }],
      CALENDAR_URL,
    )).toEqual([]);
  });

  it("ignores rows that were never requested", () => {
    expect(findMissingHrefs(
      ["/cal/u/a.ics"],
      [{ url: `${CALENDAR_URL}a.ics` }, { url: `${CALENDAR_URL}surprise.ics` }],
      CALENDAR_URL,
    )).toEqual([]);
  });

  it("reports a requested href the server never answered", () => {
    expect(findMissingHrefs(
      ["/cal/u/a.ics", "/cal/u/b.ics"],
      [{ url: `${CALENDAR_URL}a.ics` }],
      CALENDAR_URL,
    )).toEqual(["/cal/u/b.ics"]);
  });
});

describe("CalDAVIncompleteMultiGetError", () => {
  const createError = () =>
    new CalDAVIncompleteMultiGetError({
      batchCount: 8,
      calendarUrl: CALENDAR_URL,
      hrefsRequested: 1971,
      missingHrefs: Array.from({ length: 20 }, (_unused, index) => `/cal/u/${String(index)}.ics`),
      objectsReturned: 800,
    });

  it("reports both counts and a bounded sample of the missing hrefs", () => {
    const error = createError();

    expect(error.message).toBe(
      `CalDAV multiget returned 800 of 1971 requested objects for ${CALENDAR_URL}`,
    );
    expect(error.missingHrefs).toHaveLength(5);
    expect(error.batchCount).toBe(8);
  });

  it("reports the shortfall without looking like an authentication failure", () => {
    const error = createError();

    expect(isCalDAVAuthenticationError(error)).toBe(false);
    expect("status" in error).toBe(false);
    expect("statusCode" in error).toBe(false);
  });
});

describe("CALDAV_MULTIGET_BATCH_SIZE", () => {
  it("stays below every observed provider response cap", () => {
    expect(CALDAV_MULTIGET_BATCH_SIZE).toBeLessThanOrEqual(500);
  });
});
