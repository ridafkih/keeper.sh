import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleSourceWriter } from "../../../../src/providers/google/source/mutations";
import { createOutlookSourceWriter } from "../../../../src/providers/outlook/source/mutations";

const SOURCE_EVENT_UID = "source-event-uid@example.com";
const reference = { sourceEventId: null, sourceEventUid: SOURCE_EVENT_UID };

const rejectingToken = (): Promise<string> =>
  Promise.reject(new Error("invalid_grant: Token has been expired or revoked."));

const writers = [
  {
    name: "Google",
    writer: () => createGoogleSourceWriter({
      accessToken: rejectingToken,
      externalCalendarId: "primary",
    }),
  },
  {
    name: "Outlook",
    writer: () => createOutlookSourceWriter({ accessToken: rejectingToken }),
  },
];

describe.each(writers)(
  "$name source writer: a token that cannot be refreshed is a failure, not a write",
  (target) => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("answers a failure rather than throwing when a delete cannot get a token", async () => {
      const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await target.writer().deleteEvent(reference);

      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf("string");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("answers a failure rather than throwing when an update cannot get a token", async () => {
      const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await target.writer().updateEvent(reference, { summary: "Renamed" });

      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf("string");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  },
);
