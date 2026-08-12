import { describe, expect, it } from "vitest";
import {
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
  toExistingCalendars,
} from "../../../src/core/source/calendar-rediscovery";

describe("toDiscoveredGoogleCalendars", () => {
  it("keys on the calendar list id and derives write access from the access role", () => {
    const calendars = toDiscoveredGoogleCalendars([
      { accessRole: "owner", id: "owned@group.calendar.google.com", summary: "Owned" },
      { accessRole: "writer", id: "writable@group.calendar.google.com", summary: "Writable" },
      { accessRole: "reader", id: "readonly@group.calendar.google.com", summary: "Read Only" },
      { accessRole: "freeBusyReader", id: "busy@group.calendar.google.com", summary: "Busy" },
    ]);

    expect(calendars.map(({ writable }) => writable)).toEqual([true, true, false, false]);
    expect(calendars[0]).toEqual({
      calendarUrl: null,
      externalCalendarId: "owned@group.calendar.google.com",
      identityKey: "owned@group.calendar.google.com",
      name: "Owned",
      writable: true,
    });
  });
});

describe("toDiscoveredOutlookCalendars", () => {
  it("derives write access from canEdit and defaults to read only when it is absent", () => {
    const calendars = toDiscoveredOutlookCalendars([
      { canEdit: true, id: "AAMkAD-writable", name: "Calendar" },
      { canEdit: false, id: "AAMkAD-readonly", name: "Shared" },
      { id: "AAMkAD-unknown", name: "Unknown" },
    ]);

    expect(calendars.map(({ writable }) => writable)).toEqual([true, false, false]);
    expect(calendars[1]).toEqual({
      calendarUrl: null,
      externalCalendarId: "AAMkAD-readonly",
      identityKey: "AAMkAD-readonly",
      name: "Shared",
      writable: false,
    });
  });
});

describe("toDiscoveredCalDAVCalendars", () => {
  it("keys on the normalized pathname while keeping the discovered absolute URL", () => {
    const calendars = toDiscoveredCalDAVCalendars([
      {
        ctag: "ctag-1",
        displayName: "Work",
        url: "http://cloud.example.com:8080/remote.php/dav/calendars/bob/work/",
      },
    ]);

    expect(calendars).toEqual([{
      calendarUrl: "http://cloud.example.com:8080/remote.php/dav/calendars/bob/work/",
      externalCalendarId: null,
      identityKey: "/remote.php/dav/calendars/bob/work",
      name: "Work",
      writable: true,
    }]);
  });
});

describe("toExistingCalendars", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("keys OAuth rows on the stored external calendar id", () => {
    const rows = toExistingCalendars(
      [{
        calendarUrl: null,
        createdAt,
        externalCalendarId: "external-1",
        id: "calendar-1",
        unavailableSince: null,
      }],
      "oauth",
    );

    expect(rows).toEqual([{
      calendarUrl: null,
      createdAt,
      id: "calendar-1",
      identityKey: "external-1",
      unavailableSince: null,
    }]);
  });

  it("keys CalDAV rows on the normalized stored URL", () => {
    const rows = toExistingCalendars(
      [{
        calendarUrl: "https://cloud.example.com/dav/bob/My%20Work/",
        createdAt,
        externalCalendarId: null,
        id: "calendar-1",
        unavailableSince: null,
      }],
      "caldav",
    );

    expect(rows[0]?.identityKey).toBe("/dav/bob/My Work");
    expect(rows[0]?.calendarUrl).toBe("https://cloud.example.com/dav/bob/My%20Work/");
  });

  it("fails loudly and names the calendar when a stored CalDAV URL cannot be parsed", () => {
    expect(() => toExistingCalendars(
      [{
        calendarUrl: "not-a-url",
        createdAt,
        externalCalendarId: null,
        id: "calendar-broken",
        unavailableSince: null,
      }],
      "caldav",
    )).toThrow(/calendar-broken/u);
  });

  it("excludes an OAuth destination row that carries no external calendar id", () => {
    const rows = toExistingCalendars(
      [
        {
          calendarUrl: null,
          createdAt,
          externalCalendarId: null,
          id: "calendar-destination",
          unavailableSince: null,
        },
        {
          calendarUrl: null,
          createdAt,
          externalCalendarId: "external-1",
          id: "calendar-source",
          unavailableSince: null,
        },
      ],
      "oauth",
    );

    expect(rows.map(({ id }) => id)).toEqual(["calendar-source"]);
  });

  it("excludes a CalDAV destination row that carries no calendar URL", () => {
    const rows = toExistingCalendars(
      [{
        calendarUrl: null,
        createdAt,
        externalCalendarId: null,
        id: "calendar-destination",
        unavailableSince: null,
      }],
      "caldav",
    );

    expect(rows).toEqual([]);
  });
});
