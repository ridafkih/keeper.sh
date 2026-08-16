import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/rida";
const SOURCE_EVENT_UID = "source-event-uid-1";
const NO_CONTENT_STATUS = 204;
const FORBIDDEN_STATUS = 403;
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;

/*
 * Nextcloud, Radicale, Baikal, Synology and Zimbra authenticate by bare username, and
 * nothing in the CalDAV connect flow stores an email, so this is the writer production
 * builds on every one of them: no address to weigh an ORGANIZER against. The event is the
 * user's own, on the user's own collection, and the server granted the write.
 */
const buildIcs = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${SOURCE_EVENT_UID}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Studio booked",
  ...lines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const OWN_EVENT = buildIcs(["ORGANIZER;CN=Rida:mailto:rida@example.com"]);

const MEETING = buildIcs([
  "ORGANIZER;CN=Rida:mailto:rida@example.com",
  "ATTENDEE;CN=Colleague;PARTSTAT=ACCEPTED:mailto:colleague@example.com",
]);

const createWriter = (data: string, writeStatus = NO_CONTENT_STATUS) => {
  const deleted: string[] = [];
  const updated: { data: string; url: string }[] = [];
  const client = {
    deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
      deleted.push(request.calendarObject.url);
      return Promise.resolve(new Response(null, { status: writeStatus }));
    },
    fetchCalendarObjects: () => Promise.resolve([{ data, url: OBJECT_URL }]),
    updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
      updated.push(request.calendarObject);
      return Promise.resolve(new Response(null, { status: writeStatus }));
    },
  };

  return {
    deleted,
    updated,
    writer: createCalDAVSourceWriter({
      accountEmail: null,
      accountUsername: "rida",
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(client),
    }),
  };
};

describe("a CalDAV server that signs the user in by username", () => {
  it("edits the user's own event rather than refusing it", async () => {
    const { updated, writer } = createWriter(OWN_EVENT);

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(result).toEqual({ success: true });
    expect(updated).toHaveLength(1);
  });

  it("deletes the user's own event rather than refusing it", async () => {
    const { deleted, writer } = createWriter(OWN_EVENT);

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBeUndefined();
    expect(result).toEqual({ success: true });
    expect(deleted).toEqual([OBJECT_URL]);
  });

  /*
   * The one refusal that survives. Cancelling this event mails the colleague and no
   * answer here can recall that, so the attendee the writer can plainly see decides it —
   * not the organizer it has nothing to compare against.
   */
  it("still refuses to delete a meeting other people are invited to", async () => {
    const { deleted, writer } = createWriter(MEETING);

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_has_attendees");
    expect(deleted).toEqual([]);
  });

  /*
   * Deferring to the server's ACL means the server's answer is the one that stands. A
   * write it rejects is still a failed write and still reaches the user.
   */
  it("reports the server's own rejection of an edit as a failure", async () => {
    const { writer } = createWriter(OWN_EVENT, FORBIDDEN_STATUS);

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBeUndefined();
    expect(result.error).toContain(String(FORBIDDEN_STATUS));
  });
});
