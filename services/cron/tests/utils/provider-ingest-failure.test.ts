import { RequestTimeoutError } from "@keeper.sh/calendar";
import {
  CalDAVIncompleteMultiGetError,
  CalDAVUnreadableResourceError,
} from "@keeper.sh/calendar/caldav";
import { describe, expect, it } from "vitest";
import {
  resolveMissingCalendarFailure,
  shouldTreatAsProviderAuthFailure,
} from "../../src/utils/provider-ingest-failure";

describe("resolveMissingCalendarFailure", () => {
  it("keeps a missing provider calendar retriable without globally disabling it", () => {
    const policy = resolveMissingCalendarFailure(new Error("Collection query failed: 404 Not Found"));

    expect(policy).toEqual({
      disableCalendar: false,
      retriable: true,
      slug: "provider-calendar-not-found",
    });
  });

  it("does not classify unrelated provider errors as a missing calendar", () => {
    expect(resolveMissingCalendarFailure(new Error("HTTP 500"))).toBeNull();
  });

  it("leaves a truncated multiget to its own slug even when 404 appears in the message", () => {
    const truncations = [
      { calendarUrl: "https://caldav.zoho.com/caldav/u/events/a9f404bc7e" },
      { objectsReturned: 404 },
      { hrefsRequested: 404 },
    ];

    for (const truncation of truncations) {
      const error = new CalDAVIncompleteMultiGetError({
        batchCount: 8,
        calendarUrl: "https://caldav.zoho.com/caldav/u/events/abc",
        hrefsRequested: 1971,
        missingHrefs: ["/caldav/u/events/abc/event.ics"],
        objectsReturned: 1000,
        ...truncation,
      });

      expect(error.message).toContain("404");
      expect(resolveMissingCalendarFailure(error)).toBeNull();
    }
  });

  it("leaves an unreadable-resource failure to its own slug", () => {
    const error = new CalDAVUnreadableResourceError({
      skippedResourceCount: 2,
      skippedResourceReasons: [
        "Malformed ICS component boundary: missing END:VEVENT",
        "Collection query failed: 404 Not Found",
      ],
    });

    expect(error.message).toContain("404");
    expect(resolveMissingCalendarFailure(error)).toBeNull();
  });
});

describe("shouldTreatAsProviderAuthFailure", () => {
  it("treats a genuine CalDAV 401 as a provider auth failure", () => {
    expect(shouldTreatAsProviderAuthFailure(new Error("Invalid credentials"))).toBe(true);
    expect(shouldTreatAsProviderAuthFailure({ status: 401 })).toBe(true);
  });

  it("does not blame the provider for our own rejected database credentials", () => {
    const cause = Object.assign(new Error('password authentication failed for user "keeper"'), {
      errno: "28P01",
      name: "PostgresError",
    });

    expect(shouldTreatAsProviderAuthFailure(new Error("Failed query", { cause }))).toBe(false);
  });

  it("does not blame the provider for a request timeout carrying a stale 401", () => {
    const timeout = Object.assign(new RequestTimeoutError(90_000), { status: 401 });

    expect(shouldTreatAsProviderAuthFailure(timeout)).toBe(false);
  });

  it("leaves an incomplete multiget to its own slug", () => {
    const error = Object.assign(
      new CalDAVIncompleteMultiGetError({
        batchCount: 8,
        calendarUrl: "https://caldav.example.com/cal/u/",
        hrefsRequested: 1971,
        missingHrefs: ["/cal/u/event.ics"],
        objectsReturned: 1000,
      }),
      { status: 401 },
    );

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(false);
  });

  it("leaves an unreadable-resource failure to its own slug", () => {
    const error = Object.assign(
      new CalDAVUnreadableResourceError({
        skippedResourceCount: 2,
        skippedResourceReasons: ["Invalid credentials"],
      }),
      { status: 401 },
    );

    expect(shouldTreatAsProviderAuthFailure(error)).toBe(false);
  });
});
