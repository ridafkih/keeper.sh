import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSafeFetch } from "../../src/utils/safe-fetch";
import type { SafeFetchOptions } from "../../src/utils/safe-fetch";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const enabledOptions: SafeFetchOptions = { blockPrivateResolution: true };

const FIRST_ADDRESS = "93.184.216.34";
const SECOND_ADDRESS = "93.184.216.35";
const ICS_BODY = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:NEW EVENT\r\nEND:VEVENT\r\nEND:VCALENDAR";

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const installMockFetch = (mockFn: ReturnType<typeof vi.fn<FetchFn>>): void => {
  Object.assign(globalThis, { fetch: mockFn });
};

const connectionError = (code: string): Error => Object.assign(new Error(`connect ${code}`), { code });

const writesSeen = (mockFn: ReturnType<typeof vi.fn<FetchFn>>): number =>
  mockFn.mock.calls.filter((call) => (call[1]?.method ?? "GET") === "PUT").length;

describe("safe-fetch does not replay a non-idempotent write", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not re-send a PUT after the socket resets", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>(() => Promise.reject(connectionError("ECONNRESET")));
    installMockFetch(mockFetch);

    await createSafeFetch(enabledOptions)("https://caldav.example.com/cal/new-event.ics", {
      body: ICS_BODY,
      headers: { "If-None-Match": "*", "content-type": "text/calendar" },
      method: "PUT",
    }).catch(() => null);

    expect(writesSeen(mockFetch)).toBe(1);
  });

  it("does not re-send a PUT at every pinned address", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS, SECOND_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>(() => Promise.reject(connectionError("ECONNRESET")));
    installMockFetch(mockFetch);

    await createSafeFetch(enabledOptions)("https://caldav.example.com/cal/new-event.ics", {
      body: ICS_BODY,
      headers: { "If-None-Match": "*", "content-type": "text/calendar" },
      method: "PUT",
    }).catch(() => null);

    expect(writesSeen(mockFetch)).toBe(1);
  });

  it("still retries an idempotent GET on a stale socket", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockRejectedValueOnce(connectionError("ECONNRESET"));
    mockFetch.mockResolvedValueOnce(new Response("calendar", { status: 200 }));
    installMockFetch(mockFetch);

    const response = await createSafeFetch(enabledOptions)("https://caldav.example.com/cal.ics");

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
