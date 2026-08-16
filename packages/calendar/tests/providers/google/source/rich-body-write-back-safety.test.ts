import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";
import { toPlainTextDescription } from "../../../../src/core/events/plain-text-description";

const ACCESS_TOKEN = "google-access-token";
const SOURCE_EVENT_ID = "google-event-id";
const SOURCE_EVENT_UID = "source-event-uid";

/*
 * Google keeps a description as the markup it was written with, and every copy Keeper.sh
 * makes of it is a plain-text projection: the anchor a meeting provider wrote in becomes
 * its own label and a bare url. Writing that projection back replaces the real event's
 * markup with it, and the href — often the only place the join link lives — is gone with
 * nothing anywhere to restore it from.
 */
const RICH_DESCRIPTION =
  "<p>Agenda attached.</p><p><a href=\"https://zoom.us/j/9876543210\">Join the call</a></p>";

const RICH_DESCRIPTION_EVENT = {
  attendees: [],
  description: RICH_DESCRIPTION,
  id: SOURCE_EVENT_ID,
  summary: "Weekly sync",
};

const PLAIN_DESCRIPTION_EVENT = {
  attendees: [],
  description: "Agenda attached.",
  id: SOURCE_EVENT_ID,
  summary: "Weekly sync",
};

interface RecordedRequest {
  body: string | null;
  method: string;
}

const createWriter = () =>
  createGoogleSourceWriter({
    accessToken: () => Promise.resolve(ACCESS_TOKEN),
    externalCalendarId: "primary",
  });

describe("a Google source description Keeper.sh only ever copied as text is not overwritten", () => {
  let requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  const respondWith = (event: Record<string, unknown>): void => {
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ body: (init?.body as string | undefined) ?? null, method });
      if (method === "GET" && String(input).includes("iCalUID")) {
        return Promise.resolve(Response.json({ items: [event] }, { status: 200 }));
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

  it("refuses to replace a formatted source description with the copy's plain text", async () => {
    respondWith(RICH_DESCRIPTION_EVENT);
    const copiedDescription = `${toPlainTextDescription(RICH_DESCRIPTION)}\nBring the mocks`;

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { description: copiedDescription },
    );

    expect(patches()).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.refused).toBe("event_body_is_rich_text");
  });

  /*
   * The refusal is about the description alone. A rename carries nothing that could
   * replace the markup, so it still reaches the source.
   */
  it("still writes a rename to an event whose description carries markup", async () => {
    respondWith(RICH_DESCRIPTION_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { summary: "Renamed on the destination" },
    );

    expect(result).toEqual({ success: true });
    expect(patches()).toHaveLength(1);
  });

  it("still writes a description to an event whose description is already plain text", async () => {
    respondWith(PLAIN_DESCRIPTION_EVENT);

    const result = await createWriter().updateEvent(
      { sourceEventId: SOURCE_EVENT_ID, sourceEventUid: SOURCE_EVENT_UID },
      { description: "Agenda attached. Bring the mocks." },
    );

    expect(result).toEqual({ success: true });
    expect(patches()).toHaveLength(1);
  });
});
