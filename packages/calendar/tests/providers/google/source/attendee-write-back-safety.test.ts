import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";

const ACCESS_TOKEN = "google-access-token";
const SOURCE_EVENT_ID = "google-event-id";
const SOURCE_EVENT_UID = "source-event-uid@example.com";
const TIMED_START = new Date("2027-05-11T17:00:00.000Z");
const TIMED_END = new Date("2027-05-11T18:00:00.000Z");

const MEETING_WITH_ATTENDEES = {
  attendees: [
    { email: "organizer@example.com", responseStatus: "accepted", self: true },
    { email: "colleague@example.com", responseStatus: "accepted" },
    { email: "outside@another-company.com", responseStatus: "needsAction" },
  ],
  id: SOURCE_EVENT_ID,
  organizer: { email: "organizer@example.com" },
  summary: "Quarterly review",
};

const SOLO_EVENT = { id: SOURCE_EVENT_ID, summary: "Focus block" };

interface RecordedRequest {
  method: string;
  url: string;
}

const createWriter = () => createGoogleSourceWriter({
  accessToken: () => Promise.resolve(ACCESS_TOKEN),
  externalCalendarId: "primary",
});

describe("a Google source write never touches an event other people are on", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  const respondWith = (event: Record<string, unknown>): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(input) });
      if (method === "GET" && String(input).includes("iCalUID")) {
        return Promise.resolve(Response.json({ items: [event] }, { status: 200 }));
      }
      if (method === "GET") {
        return Promise.resolve(Response.json(event, { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses to delete a meeting that has other attendees", async () => {
    respondWith(MEETING_WITH_ATTENDEES);

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("refuses to reschedule a meeting that has other attendees", async () => {
    respondWith(MEETING_WITH_ATTENDEES);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  it("refuses even when the event is reached through the UID lookup", async () => {
    respondWith(MEETING_WITH_ATTENDEES);

    const result = await createWriter().deleteEvent({
      sourceEventId: null,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("still writes an event nobody else is on", async () => {
    respondWith(SOLO_EVENT);

    const updated = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );
    const deleted = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(updated).toEqual({ success: true });
    expect(deleted).toEqual({ success: true });
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
  });
});
