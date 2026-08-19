import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockSafeFetch } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}));

vi.mock("../../../src/utils/safe-fetch", () => ({
  createSafeFetch: () => mockSafeFetch,
}));

const buildEvent = (uid: string): string => [
  "BEGIN:VEVENT",
  `UID:${uid}@test`,
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260517T120000Z",
  "DTEND:20260517T130000Z",
  `SUMMARY:Event ${uid}`,
  "END:VEVENT",
].join("\r\n");

const FULL_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  buildEvent("event-1"),
  buildEvent("event-2"),
  buildEvent("event-3"),
  "END:VCALENDAR",
].join("\r\n");

/*
 * The feed cut mid-body: VERSION and PRODID survive at the top, event-1 is
 * intact, events 2-3 and END:VCALENDAR are gone. This is what a size-capping
 * proxy, a partial origin write with valid HTTP framing, or a 206 response
 * body looks like.
 */
const TRUNCATED_ICS = FULL_ICS.slice(0, FULL_ICS.indexOf("BEGIN:VEVENT\r\nUID:event-2"));

describe("pullRemoteCalendar truncated feed", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("rejects a body truncated after the header instead of returning a partial event set", async () => {
    /*
     * If this resolves, the strictly-smaller event set is persisted as an
     * authoritative snapshot and the ingest diff mass-deletes every stored
     * event after the cut, then re-adds them all on the next complete fetch.
     */
    const { pullRemoteCalendar } = await import("../../../src/ics/utils/pull-remote-calendar");
    mockSafeFetch.mockResolvedValueOnce(new Response(TRUNCATED_ICS, { status: 200 }));

    await expect(
      pullRemoteCalendar("json", "https://example.com/calendar.ics"),
    ).rejects.toThrow();
  });

  it("rejects a 206 Partial Content body instead of treating it as the whole feed", async () => {
    /*
     * Response.ok is true for every 2xx status, 206 included, so a range
     * response passes the only status gate in fetchRemoteText.
     */
    const { pullRemoteCalendar } = await import("../../../src/ics/utils/pull-remote-calendar");
    mockSafeFetch.mockResolvedValueOnce(new Response(TRUNCATED_ICS, { status: 206 }));

    await expect(
      pullRemoteCalendar("json", "https://example.com/calendar.ics"),
    ).rejects.toThrow();
  });
});
