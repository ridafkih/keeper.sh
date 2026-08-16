import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const ACCESS_TOKEN = "outlook-access-token";
const SOURCE_EVENT_ID = "outlook-event-id";
const SOURCE_EVENT_UID = "source-event-uid";

/*
 * Every Outlook body Keeper.sh ever reads is fetched under a text preference, so the
 * markup of an html body is never stored anywhere. Writing the text projection back
 * replaces the real event's body with it and the links, formatting and the join block
 * Outlook wrote into it are gone for good.
 */
const RICH_BODY_EVENT = {
  attendees: [],
  body: {
    content: "<p>Bring the <b>deck</b> and the <a href=\"https://x.test\">agenda</a>.</p>",
    contentType: "html",
  },
  id: SOURCE_EVENT_ID,
  subject: "Focus block",
};

const PLAIN_BODY_EVENT = {
  attendees: [],
  body: { content: "Bring the deck.", contentType: "text" },
  id: SOURCE_EVENT_ID,
  subject: "Focus block",
};

const EMPTY_HTML_BODY_EVENT = {
  attendees: [],
  body: { content: "<html><head></head><body></body></html>", contentType: "html" },
  id: SOURCE_EVENT_ID,
  subject: "Focus block",
};

interface RecordedRequest {
  body: string | null;
  method: string;
}

const createWriter = () =>
  createOutlookSourceWriter({ accessToken: () => Promise.resolve(ACCESS_TOKEN) });

describe("an Outlook source body Keeper.sh only ever read as text is not overwritten", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  const respondWith = (event: Record<string, unknown>): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ body: (init?.body as string | undefined) ?? null, method });
      if (method === "GET" && String(input).includes("iCalUId")) {
        return Promise.resolve(Response.json({ value: [event] }, { status: 200 }));
      }
      if (method === "GET") {
        return Promise.resolve(Response.json(event, { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  };

  const patches = () => requests.filter(({ method }) => method === "PATCH");

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses a description write against a body that carries markup", async () => {
    respondWith(RICH_BODY_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { description: "Bring the deck and the agenda.\nAlso the laptop." },
    );

    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_body_is_rich_text");
    expect(patches()).toEqual([]);
  });

  /*
   * The refusal is about the body alone. A rename or a reschedule carries nothing that
   * could replace it, so it still reaches the source.
   */
  it("still reschedules an event whose body carries markup", async () => {
    respondWith(RICH_BODY_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result).toEqual({ success: true });
    expect(patches()).toHaveLength(1);
  });

  it("still writes a description back to a body that is already plain text", async () => {
    respondWith(PLAIN_BODY_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { description: "Bring the deck. Also the laptop." },
    );

    expect(result).toEqual({ success: true });
    expect(patches()).toHaveLength(1);
  });

  it("still writes a description into an html body that carries nothing", async () => {
    respondWith(EMPTY_HTML_BODY_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { description: "Bring the deck." },
    );

    expect(result).toEqual({ success: true });
    expect(patches()).toHaveLength(1);
  });
});
