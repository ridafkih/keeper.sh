import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/personal";
const SOURCE_EVENT_UID = "source-event-uid-1";
const NO_CONTENT_STATUS = 204;
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;

const buildMeetingIcs = (): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Quarterly review",
  "ORGANIZER;CN=Owner:mailto:owner@example.com",
  "ATTENDEE;CN=Colleague;PARTSTAT=ACCEPTED:mailto:colleague@example.com",
  "ATTENDEE;CN=Outside;PARTSTAT=NEEDS-ACTION:mailto:outside@another-company.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/*
 * An email alarm carries an ATTENDEE of its own. It names nobody the deletion would
 * notify, so it must not be read as one.
 */
const buildAlarmOnlyIcs = (): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Focus block",
  "BEGIN:VALARM",
  "ACTION:EMAIL",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Reminder",
  "SUMMARY:Reminder",
  "ATTENDEE:mailto:owner@example.com",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const createClient = (data: string) => {
  const deleted: string[] = [];
  const updated: { data: string; url: string }[] = [];

  return {
    client: {
      deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
        deleted.push(request.calendarObject.url);
        return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
      },
      fetchCalendarObjects: () => Promise.resolve([{ data, url: OBJECT_URL }]),
      updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
        updated.push(request.calendarObject);
        return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
      },
    },
    deleted,
    updated,
  };
};

const createWriter = (data: string) => {
  const stub = createClient(data);
  return {
    stub,
    writer: createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    }),
  };
};

describe("a CalDAV source write never touches an event other people are on", () => {
  it("refuses to delete an object whose event has attendees", async () => {
    const { stub, writer } = createWriter(buildMeetingIcs());

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(stub.deleted).toEqual([]);
  });

  it("refuses to edit an object whose event has attendees", async () => {
    const { stub, writer } = createWriter(buildMeetingIcs());

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: new Date("2027-05-11T19:00:00.000Z"), isAllDay: false, startTime: new Date("2027-05-11T18:00:00.000Z") },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(stub.updated).toEqual([]);
  });

  it("still writes an event whose only ATTENDEE belongs to an alarm", async () => {
    const { stub, writer } = createWriter(buildAlarmOnlyIcs());

    const updated = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(updated).toEqual({ success: true });
    expect(stub.updated).toHaveLength(1);
  });
});
