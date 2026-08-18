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

const PUBLIC_ADDRESS = "93.184.216.34";
const METADATA_ADDRESS = "169.254.169.254";

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const installMockFetch = (mockFn: ReturnType<typeof vi.fn<FetchFn>>): void => {
  Object.assign(globalThis, { fetch: mockFn });
};

const requestedUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

describe("safe-fetch pins the connection to the address it validated", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("connects to the validated address, not the rebindable hostname", async () => {
    mockResolve4.mockResolvedValueOnce([PUBLIC_ADDRESS]);
    mockResolve4.mockResolvedValue([METADATA_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://rebind.example.com/cal.ics");

    const target = requestedUrl(mockFetch.mock.calls[0]?.[0] ?? "");
    expect(target.hostname).toBe(PUBLIC_ADDRESS);
    expect(target.pathname).toBe("/cal.ics");
  });

  it("pins each redirect hop to the address that hop validated", async () => {
    mockResolve4.mockResolvedValueOnce([PUBLIC_ADDRESS]);
    mockResolve4.mockResolvedValueOnce([PUBLIC_ADDRESS]);
    mockResolve4.mockResolvedValue([METADATA_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://hop.example.com/next.ics" },
      }),
    );
    mockFetch.mockResolvedValueOnce(new Response("calendar", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://rebind.example.com/cal.ics");

    const [hopInput, hopInit] = mockFetch.mock.calls[1] ?? [];
    const target = requestedUrl(hopInput ?? "");
    expect(target.hostname).toBe(PUBLIC_ADDRESS);
    expect(target.pathname).toBe("/next.ics");

    const hopHeaders = new Headers((hopInit as BunFetchRequestInit | undefined)?.headers);
    expect(hopHeaders.get("host")).toBe("hop.example.com");
    expect((hopInit as BunFetchRequestInit | undefined)?.tls).toMatchObject({ serverName: "hop.example.com" });
  });
});
