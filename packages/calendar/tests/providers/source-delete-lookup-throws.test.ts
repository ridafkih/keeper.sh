import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../src/providers/outlook/source/mutations";
import { createCalDAVSourceWriter } from "../../src/providers/caldav/source/mutations";

const SOURCE_EVENT_UID = "source-event-uid@example.com";
const SERVICE_UNAVAILABLE = 503;
const CALENDAR_URL = "https://caldav.example.com/calendars/personal";

const GATEWAY_HTML = "<html><head><title>503 Service Unavailable</title></head></html>";

const reference = { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID };

const writers = [
  {
    name: "Google",
    writer: () => createGoogleSourceWriter({
      accessToken: () => Promise.resolve("token"),
      externalCalendarId: "primary",
    }),
  },
  {
    name: "Outlook",
    writer: () => createOutlookSourceWriter({
      accessToken: () => Promise.resolve("token"),
    }),
  },
];

/*
 * The lookup runs before anything is asked to destroy the event, so a lookup that blows up
 * has destroyed nothing. Rejecting rather than answering hides that from the caller, which
 * has already committed the record of the deletion it was about to make: the pass can only
 * release that record for an answer it can read, so an exception leaves it standing and
 * spending one of the day's source-deletion slots for a deletion that never happened.
 */
describe.each(writers)("$name source writer: a lookup that throws destroys nothing", (target) => {
  const originalFetch = globalThis.fetch;
  let calls: string[] = [];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("answers a failure when the lookup returns an unparseable error body", async () => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Promise.resolve(new Response(GATEWAY_HTML, { status: SERVICE_UNAVAILABLE }));
    }) as unknown as typeof fetch;

    const result = await target.writer().deleteEvent(reference);

    expect(result.success).toBe(false);
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });

  it("answers a failure when the lookup cannot reach the provider at all", async () => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Promise.reject(new TypeError("fetch failed"));
    }) as unknown as typeof fetch;

    const result = await target.writer().deleteEvent(reference);

    expect(result.success).toBe(false);
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });
});

describe("CalDAV source writer: a lookup that throws destroys nothing", () => {
  const createWriter = (lookup: () => Promise<never>) => {
    const attempted: string[] = [];
    return {
      attempted,
      writer: createCalDAVSourceWriter({
        calendarUrl: CALENDAR_URL,
        client: () =>
          Promise.resolve({
            deleteCalendarObject: (request: { calendarObject: { url: string } }) => {
              attempted.push(request.calendarObject.url);
              return Promise.resolve(new Response(null, { status: 204 }));
            },
            fetchCalendarObjects: lookup,
            updateCalendarObject: (request: { calendarObject: { url: string } }) => {
              attempted.push(request.calendarObject.url);
              return Promise.resolve(new Response(null, { status: 204 }));
            },
          }),
      }),
    };
  };

  it("answers a failure when the object lookup rejects", async () => {
    const { attempted, writer } = createWriter(() =>
      Promise.reject(new Error("The CalDAV server is unavailable."))
    );

    const result = await writer.deleteEvent(reference);

    expect(result.success).toBe(false);
    expect(attempted).toEqual([]);
  });
});
