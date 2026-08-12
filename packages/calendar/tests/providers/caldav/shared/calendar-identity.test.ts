import { describe, expect, it } from "vitest";
import {
  findCalendarByStoredUrl,
  normalizeCalDAVCalendarKey,
  normalizeCalDAVServerHost,
} from "../../../../src/providers/caldav/shared/calendar-identity";

describe("normalizeCalDAVCalendarKey", () => {
  it("ignores scheme, host and port drift between discovery runs", () => {
    expect(normalizeCalDAVCalendarKey("https://cloud.example.com/remote.php/dav/calendars/bob/work/"))
      .toBe(normalizeCalDAVCalendarKey("http://cloud.example.com:8080/remote.php/dav/calendars/bob/work"));
  });

  it("collapses trailing slashes", () => {
    expect(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/work"))
      .toBe(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/work///"));
  });

  it("decodes percent encoded path segments", () => {
    expect(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/My%20Work"))
      .toBe(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/My Work"));
  });

  it("keeps distinct collections distinct", () => {
    expect(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/work"))
      .not.toBe(normalizeCalDAVCalendarKey("https://cloud.example.com/dav/bob/work-2"));
  });

  it("throws on a stored value that is not a URL", () => {
    expect(() => normalizeCalDAVCalendarKey("not-a-url")).toThrow();
  });
});

describe("normalizeCalDAVServerHost", () => {
  it("reduces a stored server URL to its lowercase hostname", () => {
    expect(normalizeCalDAVServerHost("https://Cloud.Example.com:8443/remote.php/dav"))
      .toBe("cloud.example.com");
  });

  it("ignores scheme, port and path drift on the same server", () => {
    expect(normalizeCalDAVServerHost("https://cloud.example.com/remote.php/dav"))
      .toBe(normalizeCalDAVServerHost("http://cloud.example.com:8080/"));
  });

  it("never conflates two genuinely different servers", () => {
    expect(normalizeCalDAVServerHost("https://cloud.example.com/remote.php/dav"))
      .not.toBe(normalizeCalDAVServerHost("https://cloud.other-example.com/remote.php/dav"));
  });

  it("throws on a stored server value that is not a URL", () => {
    expect(() => normalizeCalDAVServerHost("cloud.example.com")).toThrow();
  });
});

describe("findCalendarByStoredUrl", () => {
  const discovered = [
    { url: "http://cloud.example.com:8080/remote.php/dav/calendars/bob/work" },
    { url: "http://cloud.example.com:8080/remote.php/dav/calendars/bob/personal" },
  ];

  it("matches a stored calendar whose absolute URL has drifted", () => {
    const match = findCalendarByStoredUrl(
      discovered,
      "https://cloud.example.com/remote.php/dav/calendars/bob/work/",
    );

    expect(match).toBe(discovered[0]);
  });

  it("returns null when the calendar is genuinely absent", () => {
    const match = findCalendarByStoredUrl(
      discovered,
      "https://cloud.example.com/remote.php/dav/calendars/bob/archive/",
    );

    expect(match).toBeNull();
  });
});
