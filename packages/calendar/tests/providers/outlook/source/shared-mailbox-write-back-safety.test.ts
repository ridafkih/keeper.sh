import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const ACCESS_TOKEN = "outlook-access-token";
const ACCOUNT_EMAIL = "me@example.com";
const SOURCE_EVENT_ID = "AAMkAGI2-shared-event";
const SOURCE_EVENT_UID = "source-event-uid@example.com";
const OK_STATUS = 200;
const FORBIDDEN_STATUS = 403;

interface RecordedRequest {
  method: string;
  url: string;
}

const createWriter = () => createOutlookSourceWriter({
  accessToken: () => Promise.resolve(ACCESS_TOKEN),
  accountEmail: ACCOUNT_EMAIL,
});

/*
 * A mailbox a colleague shared with write access. Graph granted the role, and the role is
 * the answer to who may change this event; the writer no longer asks a second time.
 */
const COLLEAGUES_EVENT = {
  id: SOURCE_EVENT_ID,
  isOrganizer: false,
  organizer: { emailAddress: { address: "colleague@example.com" } },
  subject: "Studio booked",
};

const COLLEAGUES_MEETING = {
  ...COLLEAGUES_EVENT,
  attendees: [{ emailAddress: { address: "someone@example.com" } }],
};

describe("an Outlook source write on a calendar somebody else owns", () => {
  let requests: RecordedRequest[] = [];
  let event: Record<string, unknown> = {};
  let writeStatus = OK_STATUS;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requests = [];
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

  it("deletes an event Graph says this account does not organize", async () => {
    event = COLLEAGUES_EVENT;

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
  });

  it("reschedules an event organized by another address", async () => {
    event = COLLEAGUES_EVENT;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("still refuses to delete an event that carries attendees", async () => {
    event = COLLEAGUES_MEETING;

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("still refuses to edit an event that carries attendees", async () => {
    event = COLLEAGUES_MEETING;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_has_attendees");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  it("reports Graph's own rejection of the edit as a failure rather than a refusal", async () => {
    event = COLLEAGUES_EVENT;
    writeStatus = FORBIDDEN_STATUS;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBeUndefined();
  });
});
