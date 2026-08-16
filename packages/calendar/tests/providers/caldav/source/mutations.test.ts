import { describe, expect, it } from "vitest";
import { createCalDAVSourceWriter } from "../../../../src/providers/caldav/source/mutations";

const CALENDAR_URL = "https://caldav.example.com/calendars/personal";
const SOURCE_EVENT_UID = "source-event-uid-1";
const NO_CONTENT_STATUS = 204;
const OPAQUE_OBJECT_URL = `${CALENDAR_URL}/1a2b3c4d-not-the-uid.ics`;

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

interface FetchCall {
  byFilter: boolean;
  objectUrls?: string[];
}

const createClient = (input: {
  objectsByFilter: { data?: string; url: string }[];
  objectsByUrl: { data?: string; url: string }[];
}) => {
  const calls: FetchCall[] = [];
  const deleted: string[] = [];
  const updated: { data: string; url: string }[] = [];

  return {
    calls,
    client: {
      deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
        deleted.push(request.calendarObject.url);
        return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
      },
      fetchCalendarObjects: (request: {
        filters?: Record<string, unknown>;
        objectUrls?: string[];
      }) => {
        calls.push({
          byFilter: Boolean(request.filters),
          ...(request.objectUrls && { objectUrls: request.objectUrls }),
        });
        if (request.filters) {
          return Promise.resolve(input.objectsByFilter);
        }
        return Promise.resolve(input.objectsByUrl);
      },
      updateCalendarObject: (request: { calendarObject: { data: string; url: string } }) => {
        updated.push(request.calendarObject);
        return Promise.resolve(new Response(null, { status: NO_CONTENT_STATUS }));
      },
    },
    deleted,
    updated,
  };
};

describe("createCalDAVSourceWriter", () => {
  it("finds an event whose object filename is not its UID", async () => {
    const stub = createClient({
      objectsByFilter: [{ data: buildIcs(SOURCE_EVENT_UID), url: OPAQUE_OBJECT_URL }],
      objectsByUrl: [],
    });
    const writer = createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    const result = await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result).toEqual({ success: true });
    expect(stub.updated[0]?.url).toBe(OPAQUE_OBJECT_URL);
    expect(stub.calls.at(-1)?.byFilter).toBe(true);
  });

  /*
   * Reporting a delete that never located the object would let the applier drop the local
   * rows while the real event survives, and the next ingest would bring it straight back.
   */
  it("deletes the object it actually located, not a guessed filename", async () => {
    const stub = createClient({
      objectsByFilter: [{ data: buildIcs(SOURCE_EVENT_UID), url: OPAQUE_OBJECT_URL }],
      objectsByUrl: [],
    });
    const writer = createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    await expect(writer.deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    })).resolves.toEqual({ success: true });
    expect(stub.deleted).toEqual([OPAQUE_OBJECT_URL]);
  });

  it("does not mistake another event stored at the guessed filename for the target", async () => {
    const stub = createClient({
      objectsByFilter: [],
      objectsByUrl: [{
        data: buildIcs("a-different-event-uid"),
        url: `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`,
      }],
    });
    const writer = createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    await expect(writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    )).resolves.toMatchObject({ success: false });
    expect(stub.updated).toEqual([]);
  });

  it("takes the fast path when the filename does happen to be the UID", async () => {
    const stub = createClient({
      objectsByFilter: [],
      objectsByUrl: [{
        data: buildIcs(SOURCE_EVENT_UID),
        url: `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`,
      }],
    });
    const writer = createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.byFilter).toBe(false);
  });

  it("keeps the event's own all-day shape when the payload does not override it", async () => {
    const stub = createClient({
      objectsByFilter: [],
      objectsByUrl: [{
        data: buildIcs(SOURCE_EVENT_UID),
        url: `${CALENDAR_URL}/${SOURCE_EVENT_UID}.ics`,
      }],
    });
    const writer = createCalDAVSourceWriter({
      calendarUrl: CALENDAR_URL,
      client: () => Promise.resolve(stub.client),
    });

    await writer.updateEvent(
      { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: new Date("2027-05-12T15:00:00.000Z"), isAllDay: false, startTime: new Date("2027-05-12T14:00:00.000Z") },
    );

    expect(stub.updated[0]?.data).toContain("DTSTART:20270512T140000Z");
  });
});
