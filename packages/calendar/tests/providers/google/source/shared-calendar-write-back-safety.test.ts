import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteBackReach } from "../../../../src/core/source/writer";
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
 * writer role Google granted answers whether this account may write there. It does not
 * answer whose event this is. The colleague created it, nobody is invited to it, and it is
 * their data: a mirror that concluded on its own that a copy went missing must not destroy
 * it, which is what the product page promises and what the account holder can no longer
 * undo for them.
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

const createWriter = (writeBackReach: WriteBackReach = "own_events") => createGoogleSourceWriter({
  accessToken: () => Promise.resolve(ACCESS_TOKEN),
  accountEmail: ACCOUNT_EMAIL,
  externalCalendarId: SHARED_CALENDAR_ID,
  writeBackReach,
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

  it("refuses to delete an event the user did not create", async () => {
    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(result.success).toBe(false);
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  it("refuses to edit an event the user did not create", async () => {
    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(result.success).toBe(false);
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  /*
   * The account's own event on the same shared calendar still travels: the refusal is the
   * answer to who created it, not to whose calendar it sits on. Google names the shared
   * calendar as the organizer of everything on it, which is why creator is what is read.
   */
  it("still edits an event the user created on the shared calendar", async () => {
    event = { ...SOMEONE_ELSES_EVENT, creator: { email: ACCOUNT_EMAIL, self: true } };

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  /*
   * The event is both somebody else's and carries guests. The authorship answer is the one
   * reported because it is the one no grant widens: naming the guest list here would offer
   * the user a permission that, once given, still refuses this write.
   */
  it("still refuses to delete an event other people are invited to", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter().deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  /*
   * The event is both somebody else's and carries guests. The authorship answer is the one
   * reported because it is the one no grant widens: naming the guest list here would offer
   * the user a permission that, once given, still refuses this write.
   */
  it("still refuses to edit an event other people are invited to", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  /*
   * The ceiling. Granting shared events answers a question about the user's own meetings;
   * it says nothing about a colleague's booking, and no answer to it ever will. If this
   * pair of cases goes green with the guard removed, the grant has become a way to destroy
   * somebody else's data.
   */
  it("still refuses to edit somebody else's event when shared events are granted", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter("my_meetings_notifying").updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(requests.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  it("still refuses to delete somebody else's event when shared events are granted", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter("my_meetings_notifying").deleteEvent({
      sourceEventId: SOURCE_EVENT_ID,
      sourceEventUid: SOURCE_EVENT_UID,
    });

    expect(result.refused).toBe("event_authored_by_someone_else");
    expect(requests.filter(({ method }) => method === "DELETE")).toEqual([]);
  });

  /*
   * The top of the ladder. Google granted this account write access to the calendar, and at
   * this level the user has said to use it — so a colleague's event is theirs to change.
   * It is the only level that opens this, which is why the two below it still refuse above.
   */
  it("writes to somebody else's event once any_event is granted", async () => {
    event = SOMEONE_ELSES_MEETING;

    const result = await createWriter("any_event").updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.refused).toBeUndefined();
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("reports Google's own rejection of the edit as a failure rather than a refusal", async () => {
    event = { ...SOMEONE_ELSES_EVENT, creator: { email: ACCOUNT_EMAIL, self: true } };
    writeStatus = FORBIDDEN_STATUS;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBeUndefined();
  });
});
