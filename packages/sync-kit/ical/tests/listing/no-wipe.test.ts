import { describe, expect, test } from "vitest";
import { parseIcsDocument, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope } from "../support/feed";
import { testOptions } from "../support/options";

const projectBody = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("a body this package cannot read", () => {
  test("ICAL-O1: a body with no BEGIN:VCALENDAR never produces a listing", () => {
    const projection = projectBody("this is a login page, not a calendar\r\n");

    expect(projection.ok).toBe(false);
  });

  test("ICAL-O1: an HTML error page is refused rather than read as a calendar with no events", () => {
    const projection = projectBody("<!doctype html><html><body>404</body></html>");

    expect(projection.ok).toBe(false);
    if (projection.ok) {
      return;
    }
    expect(projection.failure.kind).toBe("transport");
  });

  test("ICAL-O2: an empty body is unreadable, not an empty snapshot", () => {
    const document = parseIcsDocument("", testOptions());

    expect(document).toEqual({ kind: "unreadable", reason: "emptyBody" });
  });

  test("ICAL-O2: a truncated response is unreadable rather than an authoritative deletion", () => {
    const truncated = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:evt-1\r\n";
    const document = parseIcsDocument(truncated, testOptions());

    expect(document.kind).toBe("unreadable");
  });

  test("ICAL-O3: a well-formed VCALENDAR with zero VEVENTs is an authoritative empty snapshot", () => {
    const projection = projectBody(calendarWith([]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.kind).toBe("snapshot");
    expect(projection.value.listing.events).toEqual([]);
    expect(projection.value.present).toEqual([]);
    expect(projection.value.listing.coverage.calendar).toEqual(testScope.calendar);
  });
});
