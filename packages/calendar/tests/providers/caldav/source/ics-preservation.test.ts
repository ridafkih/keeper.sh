import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/personal";
const SOURCE_EVENT_UID = "source-event-uid-1";
const ORGANIZER_LOGIN = "ada@example.com";
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;
const NO_CONTENT_STATUS = 204;

const ORIGINAL_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 14//EN",
  "CALSCALE:GREGORIAN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART;TZID=Europe/Berlin:20270511T140000",
  "DTEND;TZID=Europe/Berlin:20270511T150000",
  "SUMMARY:Quarterly review",
  "DESCRIPTION:Bring the notes",
  "LOCATION:Room 4",
  String.raw`X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE=Clinic:geo:52.5\,13.4`,
  "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.example.com/l/meetup/abc",
  "CATEGORIES:Work,Planning",
  `ORGANIZER;CN=Ada:mailto:${ORGANIZER_LOGIN}`,
  "SEQUENCE:4",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const createClient = () => {
  const updated: { data: string; url: string }[] = [];

  return {
    client: {
      deleteCalendarObject: () => Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS })),
      fetchCalendarObjects: () =>
        Promise.resolve([{ data: ORIGINAL_ICS, url: OBJECT_URL }]),
      updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
        updated.push(request.calendarObject);
        return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
      },
    },
    updated,
  };
};

const writeSummary = async (): Promise<string> => {
  const stub = createClient();
  const writer = createCalDAVSourceWriter({
    accountUsername: ORGANIZER_LOGIN,
    calendarUrl: CALENDAR_URL,
    client: () => Promise.resolve(stub.client),
  });

  const result = await writer.updateEvent(
    { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
    { summary: "Renamed on the destination" },
  );

  expect(result).toEqual({ success: true });
  const [written] = stub.updated;
  if (!written) {
    throw new Error("Expected the writer to update the calendar object");
  }
  return written.data;
};

/*
 * The fixture carries no ATTENDEE: an event with one is refused outright rather than
 * edited, which attendee-write-back-safety.test.ts is what proves.
 */
describe("a CalDAV source write-back edits the user's event without rewriting it", () => {
  it("applies the change it was given", async () => {
    const written = await writeSummary();

    expect(written).toContain("SUMMARY:Renamed on the destination");
    expect(written).not.toContain("SUMMARY:Quarterly review");
  });

  it("keeps the non-standard properties the model cannot represent", async () => {
    const written = await writeSummary();

    expect(written).toContain("X-APPLE-STRUCTURED-LOCATION");
    expect(written).toContain("X-MICROSOFT-SKYPETEAMSMEETINGURL");
  });

  it("keeps the timezone definition its own dates reference", async () => {
    const written = await writeSummary();

    expect(written).toContain("BEGIN:VTIMEZONE");
    expect(written).toContain("TZID:Europe/Berlin");
  });

  it("leaves every property it was not asked to change exactly as it found it", async () => {
    const written = await writeSummary();

    expect(written).toContain("DESCRIPTION:Bring the notes");
    expect(written).toContain("LOCATION:Room 4");
    expect(written).toContain("DTSTART;TZID=Europe/Berlin:20270511T140000");
    expect(written).toContain("CATEGORIES:Work,Planning");
    expect(written).toContain("ORGANIZER;CN=Ada:mailto:ada@example.com");
    expect(written).toContain("SEQUENCE:4");
    expect(written).toContain("CALSCALE:GREGORIAN");
  });

  it("moves the event without disturbing the properties around it", async () => {
    const stub = createClient();
    const writer = createCalDAVSourceWriter({
    accountUsername: ORGANIZER_LOGIN,
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      {
        endTime: new Date("2027-05-11T16:00:00.000Z"),
        isAllDay: false,
        startTime: new Date("2027-05-11T15:00:00.000Z"),
        startTimeZone: "Europe/Berlin",
      },
    );

    const [written] = stub.updated;
    expect(written?.data).toContain("DTSTART;TZID=Europe/Berlin:20270511T170000");
    expect(written?.data).toContain("DTEND;TZID=Europe/Berlin:20270511T180000");
    expect(written?.data).toContain("X-APPLE-STRUCTURED-LOCATION");
    expect(written?.data).toContain("BEGIN:VTIMEZONE");
    expect(written?.data).not.toContain("DTSTART;TZID=Europe/Berlin:20270511T140000");
  });
});
