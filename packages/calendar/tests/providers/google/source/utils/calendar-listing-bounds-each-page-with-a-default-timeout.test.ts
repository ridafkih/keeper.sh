import { afterEach, describe, expect, it, vi } from "vitest";
import { listUserCalendars } from "../../../../../src/providers/google/source/utils/list-calendars";

const ASSERTION_WINDOW_MS = 2000;
const INJECTED_TIMEOUT_MS = 250;

const settlementOf = async (listing: Promise<unknown>) => {
  const outcome = await Promise.race([
    listing.then(() => "resolved" as const, () => "rejected" as const),
    Bun.sleep(ASSERTION_WINDOW_MS).then(() => "still pending" as const),
  ]);
  return outcome;
};

describe("google calendar listing bounds each page with a default timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a request timeout when the caller supplies no signal", async () => {
    const recorded: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) => {
      recorded.push(init);
      return Promise.resolve(Response.json({ items: [], kind: "calendar#calendarList" }));
    });

    await listUserCalendars("access-token");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects instead of hanging when the provider accepts the page request and goes silent", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const server = Bun.serve({ fetch: () => new Promise<Response>(() => {}), port: 0 });
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) =>
      realFetch(server.url, init));

    try {
      const listing = listUserCalendars("access-token", { requestTimeoutMs: INJECTED_TIMEOUT_MS });

      expect(await settlementOf(listing)).toBe("rejected");
    } finally {
      await server.stop(true);
    }
  });

  it("still aborts on a caller-supplied signal that fires before the default timeout", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const server = Bun.serve({ fetch: () => new Promise<Response>(() => {}), port: 0 });
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) =>
      realFetch(server.url, init));

    try {
      const listing = listUserCalendars("access-token", {
        requestTimeoutMs: 60_000,
        signal: AbortSignal.timeout(INJECTED_TIMEOUT_MS),
      });

      expect(await settlementOf(listing)).toBe("rejected");
    } finally {
      await server.stop(true);
    }
  });
});
