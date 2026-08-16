import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/personal";
const SOURCE_EVENT_UID = "source-event-uid-1";
const OBJECT_URL = `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`;
const FORBIDDEN_STATUS = 403;
const GONE_STATUS = 404;
const NO_CONTENT_STATUS = 204;

const buildIcs = (uid: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Example//EN",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20270101T000000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Quarterly review",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/*
 * Tsdav resolves its writes with the raw fetch Response and rejects on nothing but a
 * transport error, so a server that refuses the write arrives here as a resolved value.
 */
const createClient = (status: number) => {
  const attempted: string[] = [];

  return {
    attempted,
    client: {
      deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
        attempted.push(request.calendarObject.url);
        return Promise.resolve(new Response(null, { status }));
      },
      fetchCalendarObjects: () =>
        Promise.resolve([{ data: buildIcs(SOURCE_EVENT_UID), url: OBJECT_URL }]),
      updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
        attempted.push(request.calendarObject.url);
        return Promise.resolve(new Response(null, { status }));
      },
    },
  };
};

const createWriter = (status: number) => {
  const stub = createClient(status);
  return {
    attempted: stub.attempted,
    writer: createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    }),
  };
};

describe("a CalDAV source that refuses the write is not reported as written", () => {
  it("fails the edit the server rejected", async () => {
    const { writer } = createWriter(FORBIDDEN_STATUS);

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.success).toBe(false);
  });

  it("fails the deletion the server rejected", async () => {
    const { writer } = createWriter(FORBIDDEN_STATUS);

    const result = await writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.success).toBe(false);
  });

  it("reads a deletion the server answers not-found as already gone", async () => {
    const { writer } = createWriter(GONE_STATUS);

    await expect(writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    })).resolves.toEqual({ success: true });
  });

  it("still reports the write the server accepted", async () => {
    const { writer } = createWriter(NO_CONTENT_STATUS);

    await expect(writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    )).resolves.toEqual({ success: true });
    await expect(writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    })).resolves.toEqual({ success: true });
  });
});
