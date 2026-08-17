import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/team";
const SOURCE_EVENT_UID = "source-event-uid-1";
const ACCOUNT_EMAIL = "me@example.com";
const NO_CONTENT_STATUS = 204;
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;

/*
 * An object on a collection shared with write access. The server answered whether this
 * account may write there; it did not answer whose object it is. This account signs in as
 * an address, so ORGANIZER naming a colleague is an answer — and destroying their booking
 * on a conclusion a mirror reached by itself is not the account holder's to make.
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

const COLLEAGUES_EVENT = buildIcs(["ORGANIZER;CN=Colleague:mailto:colleague@example.com"]);

const COLLEAGUES_MEETING = buildIcs([
  "ORGANIZER;CN=Colleague:mailto:colleague@example.com",
  "ATTENDEE;CN=Someone;PARTSTAT=ACCEPTED:mailto:someone@example.com",
]);

const createWriter = (data: string) => {
  const deleted: string[] = [];
  const updated: { data: string; url: string }[] = [];
  const client = {
    deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
      deleted.push(request.calendarObject.url);
      return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
    },
    fetchCalendarObjects: () => Promise.resolve([{ data, url: OBJECT_URL }]),
    updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
      updated.push(request.calendarObject);
      return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
    },
  };

  return {
    deleted,
    updated,
    writer: createCalDAVSourceWriter({
      accountEmail: ACCOUNT_EMAIL,
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(client),
    }),
  };
};

describe("a CalDAV source write on a collection somebody else owns", () => {
  it("refuses to edit an object another address organizes", async () => {
    const { updated, writer } = createWriter(COLLEAGUES_EVENT);

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(updated).toEqual([]);
  });

  it("refuses to delete an object another address organizes", async () => {
    const { deleted, writer } = createWriter(COLLEAGUES_EVENT);

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(deleted).toEqual([]);
  });

  /*
   * The account's own object on the very same shared collection still travels: what is
   * refused is somebody else's event, not somebody else's collection.
   */
  it("still edits an object this account organizes on the shared collection", async () => {
    const { updated, writer } = createWriter(
      buildIcs([`ORGANIZER;CN=Me:mailto:${ACCOUNT_EMAIL}`]),
    );

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(result).toEqual({ success: true });
    expect(updated).toHaveLength(1);
  });

  /*
   * The event is both somebody else's and carries guests. The authorship answer is the one
   * reported because it is the one no grant widens: naming the guest list here would offer
   * the user a permission that, once given, still refuses this write.
   */
  it("still refuses to delete an object other people are invited to", async () => {
    const { deleted, writer } = createWriter(COLLEAGUES_MEETING);

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(deleted).toEqual([]);
  });

  /*
   * The event is both somebody else's and carries guests. The authorship answer is the one
   * reported because it is the one no grant widens: naming the guest list here would offer
   * the user a permission that, once given, still refuses this write.
   */
  it("still refuses to edit an object other people are invited to", async () => {
    const { updated, writer } = createWriter(COLLEAGUES_MEETING);

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(updated).toEqual([]);
  });
});
