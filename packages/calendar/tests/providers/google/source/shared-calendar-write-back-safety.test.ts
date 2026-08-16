import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";

const ACCESS_TOKEN = "google-access-token";
const ACCOUNT_EMAIL = "me@example.com";
const SOURCE_EVENT_ID = "google-event-id";
const SOURCE_EVENT_UID = "source-event-uid@example.com";
const SHARED_CALENDAR_ID = "team-calendar@group.calendar.google.com";
const OK_STATUS = 200;
const FORBIDDEN_STATUS = 403;

/*
 * A calendar a colleague shared with write access is an ordinary two-way source, and the
 * writer role Google granted is the permission question already answered. This event is
 * one the colleague created on it, with nobody invited: deleting it reaches no third party.
 */
const SOMEONE_ELSES_EVENT = {
  creator: { email: "colleague@example.com", self: false },
  id: SOURCE_EVENT_ID,
  organizer: { email: "colleague@example.com", self: false },
  summary: "Studio booked",
};

const SOMEONE_ELSES_MEETING = {
  ...SOMEONE_ELSES_EVENT,
  attendees: [
    { email: ACCOUNT_EMAIL, self: true },
    { email: "someone@example.com" },
  ],
};

interface RecordedRequest {
  method: string;
  url: string;
}

const createWriter = () => createGoogleSourceWriter({
  accessToken: () => Promise.resolve(ACCESS_TOKEN),
  accountEmail: ACCOUNT_EMAIL,
  externalCalendarId: SHARED_CALENDAR_ID,
});

describe("a Google source write on a shared calendar", () => {
  let requests: RecordedRequest[] = [];
  let event: Record<string, unknown> = SOMEONE_ELSES_EVENT;
  let writeStatus = OK_STATUS;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requests = [];
    event = SOMEONE_ELSES_EVENT;
    writeStatus = OK_STATUS;
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(input) });
      if (method === "GET") {
        return Promise.resolve(Response.json(event, { status: OK_STATUS }));
      }
      return Promise.resolve(new Response("{}", { status: writeStatus }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("deletes an event the user did not create when nobody is invited to it", async () => {
    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
  });

  it("edits an event the user did not create when nobody is invited to it", async () => {
    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("still refuses to delete an event other people are invited to", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("still refuses to edit an event other people are invited to", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  it("reports Google's own rejection of the edit as a failure rather than a refusal", async () => {
    writeStatus = FORBIDDEN_STATUS;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBeUndefined();
  });
});
