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

const sentHeaders = (input: string | Request | URL, init: RequestInit | undefined): Headers => {
  const merged = new Headers();
  if (input instanceof Request) {
    for (const [key, value] of input.headers.entries()) {
      merged.set(key, value);
    }
  }
  for (const [key, value] of new Headers(init?.headers).entries()) {
    merged.set(key, value);
  }
  return merged;
};

describe("safe-fetch still reaches ordinary hosts with their hostname intact", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve4.mockResolvedValue([PUBLIC_ADDRESS]);
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the original Host header on a plain http request", async () => {
    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValue(new Response("BEGIN:VCALENDAR", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("http://feeds.example.com/cal.ics");

    const [input, init] = mockFetch.mock.calls[0] ?? [];
    expect(requestedUrl(input ?? "").hostname).toBe(PUBLIC_ADDRESS);
    expect(sentHeaders(input ?? "", init).get("host")).toBe("feeds.example.com");
  });

  it("sends the original Host header and TLS server name on an https request", async () => {
    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValue(new Response("BEGIN:VCALENDAR", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://feeds.example.com/cal.ics");

    const [input, init] = mockFetch.mock.calls[0] ?? [];
    expect(requestedUrl(input ?? "").hostname).toBe(PUBLIC_ADDRESS);
    expect(sentHeaders(input ?? "", init).get("host")).toBe("feeds.example.com");
    expect((init as BunFetchRequestInit | undefined)?.tls).toMatchObject({ serverName: "feeds.example.com" });
  });

  it("keeps the port in the Host header for a non-default port", async () => {
    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValue(new Response("BEGIN:VCALENDAR", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://feeds.example.com:8443/cal.ics");

    const [input, init] = mockFetch.mock.calls[0] ?? [];
    const target = requestedUrl(input ?? "");
    expect(target.hostname).toBe(PUBLIC_ADDRESS);
    expect(target.port).toBe("8443");
    expect(sentHeaders(input ?? "", init).get("host")).toBe("feeds.example.com:8443");
    expect((init as BunFetchRequestInit | undefined)?.tls).toMatchObject({ serverName: "feeds.example.com" });
  });

  it("preserves caller headers alongside the pinned Host on a Request input", async () => {
    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockResolvedValue(new Response("BEGIN:VCALENDAR", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch(new Request("https://feeds.example.com/cal.ics", { headers: { authorization: "Basic dXNlcjpwdw==" } }));

    const [input, init] = mockFetch.mock.calls[0] ?? [];
    const headers = sentHeaders(input ?? "", init);
    expect(requestedUrl(input ?? "").hostname).toBe(PUBLIC_ADDRESS);
    expect(headers.get("host")).toBe("feeds.example.com");
    expect(headers.get("authorization")).toBe("Basic dXNlcjpwdw==");
  });
});
