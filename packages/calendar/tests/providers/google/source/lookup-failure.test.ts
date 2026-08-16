import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const SOURCE_EVENT_UID = "source-event-uid@example.com";
const SERVER_ERROR = 500;
const RATE_LIMITED = 429;

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

describe.each(writers)("$name source writer: a failed lookup is never an absence", (target) => {
  const originalFetch = globalThis.fetch;
  let calls: string[] = [];

  const respondWith = (status: number, body: string): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Promise.resolve(new Response(body, { status }));
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports a failure rather than a completed delete when the lookup errors", async () => {
    respondWith(SERVER_ERROR, JSON.stringify({ error: { message: "Backend error" } }));

    const result = await target.writer().deleteEvent(reference);

    expect(result.success).toBe(false);
    expect(result.error).toBeTypeOf("string");
    expect(calls.every((call) => call.startsWith("GET"))).toBe(true);
  });

  it("reports a failure rather than a missing event when the lookup is throttled", async () => {
    respondWith(RATE_LIMITED, JSON.stringify({ error: { message: "Rate limit exceeded" } }));

    const result = await target.writer().updateEvent(reference, { summary: "Renamed" });

    expect(result.success).toBe(false);
    expect(calls.every((call) => call.startsWith("GET"))).toBe(true);
  });

  it("still reports a genuine empty answer as an event that is already gone", async () => {
    respondWith(200, JSON.stringify({ items: [], value: [] }));

    await expect(target.writer().deleteEvent(reference)).resolves.toEqual({ success: true });
  });
});
