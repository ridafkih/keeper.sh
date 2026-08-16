import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../src/providers/outlook/source/mutations";

const SOURCE_EVENT_UID = "source-event-uid@example.com";
const SERVICE_UNAVAILABLE = 503;
const OK = 200;

const GATEWAY_HTML = "<html><head><title>503 Service Unavailable</title></head></html>";

const reference = { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID };

const GOOGLE_LIST = {
  items: [{ iCalUID: SOURCE_EVENT_UID, id: "google-event-id" }],
};

const OUTLOOK_LIST = {
  value: [{ iCalUId: SOURCE_EVENT_UID, id: "outlook-event-id" }],
};

const jsonResponse = (body: unknown): Response => Response.json(body, { status: OK });

const writers = [
  {
    lookup: () => jsonResponse(GOOGLE_LIST),
    name: "Google",
    writer: () =>
      createGoogleSourceWriter({
        accessToken: () => Promise.resolve("token"),
        externalCalendarId: "primary",
      }),
  },
  {
    lookup: () => jsonResponse(OUTLOOK_LIST),
    name: "Outlook",
    writer: () =>
      createOutlookSourceWriter({ accessToken: () => Promise.resolve("token") }),
  },
];

/*
 * The provider was asked and said no. Whether its error body happens to be JSON or a
 * gateway's HTML says nothing about what became of the user's event, so both have to reach
 * the caller the same way: as an answer it can read. Rejecting instead leaves the record of
 * the deletion standing, and that record spends one of the day's source-deletion slots for
 * a deletion the provider refused.
 */
describe.each(writers)("$name source writer: a refused write answers, never throws", (target) => {
  const originalFetch = globalThis.fetch;
  let calls: string[] = [];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const stubFetch = (): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${String(input)}`);
      if (method === "GET") {
        return Promise.resolve(target.lookup());
      }
      return Promise.resolve(
        new Response(GATEWAY_HTML, {
          headers: { "content-type": "text/html" },
          status: SERVICE_UNAVAILABLE,
        }),
      );
    }) as unknown as typeof fetch;
  };

  it("answers a failure when the delete is refused with an unparseable error body", async () => {
    stubFetch();

    const result = await target.writer().deleteEvent(reference);

    expect(result.success).toBe(false);
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(true);
  });

  it("answers a failure when the edit is refused with an unparseable error body", async () => {
    stubFetch();

    const result = await target.writer().updateEvent(reference, { summary: "Renamed" });

    expect(result.success).toBe(false);
  });
});
