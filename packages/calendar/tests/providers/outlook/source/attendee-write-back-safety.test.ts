import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const ACCESS_TOKEN = "outlook-access-token";
const SOURCE_EVENT_ID = "outlook-event-id";
const SOURCE_EVENT_UID = "source-event-uid";
const TIMED_START = new Date("2027-05-11T17:00:00.000Z");
const TIMED_END = new Date("2027-05-11T18:00:00.000Z");

const MEETING_WITH_ATTENDEES = {
  attendees: [
    { emailAddress: { address: "colleague@example.com", name: "Colleague" }, type: "required" },
    { emailAddress: { address: "outside@another-company.com" }, type: "optional" },
  ],
  id: SOURCE_EVENT_ID,
  organizer: { emailAddress: { address: "owner@example.com" } },
  subject: "Quarterly review",
};

const SOLO_EVENT = { attendees: [], id: SOURCE_EVENT_ID, subject: "Focus block" };

interface RecordedRequest {
  method: string;
  url: string;
}

const createWriter = () =>
  createOutlookSourceWriter({ accessToken: () => Promise.resolve(ACCESS_TOKEN) });

describe("an Outlook source write never touches an event other people are on", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  const respondWith = (event: Record<string, unknown>): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(input) });
      if (method === "GET" && String(input).includes("iCalUId")) {
        return Promise.resolve(Response.json({ value: [event] }, { status: 200 }));
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

  it("refuses to delete a meeting that has attendees", async () => {
    respondWith(MEETING_WITH_ATTENDEES);

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("refuses to reschedule a meeting that has attendees", async () => {
    respondWith(MEETING_WITH_ATTENDEES);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { endTime: TIMED_END, isAllDay: false, startTime: TIMED_START },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
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
