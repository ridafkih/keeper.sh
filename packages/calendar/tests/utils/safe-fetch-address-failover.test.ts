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
const THIRD_ADDRESS = "93.184.216.36";

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const installMockFetch = (mockFn: ReturnType<typeof vi.fn<FetchFn>>): void => {
  Object.assign(globalThis, { fetch: mockFn });
};

const requestedHostname = (input: string | Request | URL): string => {
  if (input instanceof Request) {
    return new URL(input.url).hostname;
  }
  return new URL(input.toString()).hostname;
};

const connectionError = (code: string): Error => Object.assign(new Error(`connect ${code}`), { code });

describe("safe-fetch fails over to the next validated address", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("tries the next validated address when the first is unreachable", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS, SECOND_ADDRESS, THIRD_ADDRESS]);

    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockImplementation((input) => {
      if (requestedHostname(input) === FIRST_ADDRESS) {
        return Promise.reject(connectionError("ECONNREFUSED"));
      }
      return Promise.resolve(new Response("calendar", { status: 200 }));
    });
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    const response = await safeFetch("https://multi.example.com/cal.ics");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("calendar");

    const attempted = mockFetch.mock.calls.map((call) => requestedHostname(call[0] ?? ""));
    expect(attempted).toEqual([FIRST_ADDRESS, SECOND_ADDRESS]);
  });
});

describe("safe-fetch gives up without falling back to the hostname", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("never connects by hostname and surfaces the underlying transport failure", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS, SECOND_ADDRESS]);

    const failures = new Map<string, Error>([
      [FIRST_ADDRESS, connectionError("ECONNREFUSED")],
      [SECOND_ADDRESS, connectionError("EHOSTUNREACH")],
    ]);

    const mockFetch = vi.fn<FetchFn>();
    mockFetch.mockImplementation((input) => {
      const failure = failures.get(requestedHostname(input));
      if (!failure) {
        return Promise.resolve(new Response("leaked", { status: 200 }));
      }
      return Promise.reject(failure);
    });
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);

    const rejection = await safeFetch("https://dead.example.com/cal.ics").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toBe(failures.get(SECOND_ADDRESS));
    expect((rejection as Error & { code?: string }).code).toBe("EHOSTUNREACH");

    const attempted = mockFetch.mock.calls.map((call) => requestedHostname(call[0] ?? ""));
    expect(attempted).toEqual([FIRST_ADDRESS, SECOND_ADDRESS]);
    expect(attempted).not.toContain("dead.example.com");
    expect(mockResolve4).toHaveBeenCalledTimes(1);
  });
});

describe("safe-fetch only fails over on a failure to connect", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a server error from the first address instead of retrying the rest", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS, SECOND_ADDRESS, THIRD_ADDRESS]);
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("boom", { status: 500 })));
    installMockFetch(fetchMock);

    const response = await createSafeFetch(enabledOptions)("https://calendar.example.com/feed.ics");

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestedHostname(fetchMock.mock.calls[0]?.[0] ?? "")).toBe(FIRST_ADDRESS);
  });

  it("does not spend the remaining addresses on an aborted request", async () => {
    mockResolve4.mockResolvedValue([FIRST_ADDRESS, SECOND_ADDRESS, THIRD_ADDRESS]);
    const aborted = Object.assign(new Error("The operation was aborted."), { code: "ABORT_ERR", name: "AbortError" });
    const fetchMock = vi.fn<FetchFn>(() => Promise.reject(aborted));
    installMockFetch(fetchMock);

    const rejection = await createSafeFetch(enabledOptions)("https://calendar.example.com/feed.ics")
      .then(() => null)
      .catch((error: unknown) => error);

    expect(rejection).toBe(aborted);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("safe-fetch follows a record that genuinely changed", () => {
  const originalFetch = globalThis.fetch;
  const MOVED_ADDRESS = "93.184.216.99";

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves again on the next request rather than reusing the earlier address", async () => {
    mockResolve4.mockResolvedValueOnce([FIRST_ADDRESS]);
    mockResolve4.mockResolvedValueOnce([MOVED_ADDRESS]);
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("calendar", { status: 200 })));
    installMockFetch(fetchMock);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://calendar.example.com/feed.ics");
    await safeFetch("https://calendar.example.com/feed.ics");

    expect(mockResolve4).toHaveBeenCalledTimes(2);
    expect(requestedHostname(fetchMock.mock.calls[0]?.[0] ?? "")).toBe(FIRST_ADDRESS);
    expect(requestedHostname(fetchMock.mock.calls[1]?.[0] ?? "")).toBe(MOVED_ADDRESS);
  });

  it("rejects a host that has genuinely moved to a private address", async () => {
    mockResolve4.mockResolvedValueOnce([FIRST_ADDRESS]);
    mockResolve4.mockResolvedValueOnce(["10.0.0.5"]);
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("calendar", { status: 200 })));
    installMockFetch(fetchMock);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://calendar.example.com/feed.ics");

    await expect(safeFetch("https://calendar.example.com/feed.ics")).rejects.toThrow(
      "The provided URL resolves to a private or reserved network address.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("safe-fetch pins an IPv6 answer", () => {
  const originalFetch = globalThis.fetch;
  const IPV6_ADDRESS = "2606:2800:220:1:248:1893:25c8:1946";

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve4.mockRejectedValue(new Error("no A records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("connects to the bracketed literal when only AAAA answers", async () => {
    mockResolve6.mockResolvedValue([IPV6_ADDRESS]);
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("calendar", { status: 200 })));
    installMockFetch(fetchMock);

    await createSafeFetch(enabledOptions)("https://calendar.example.com/feed.ics");

    const target = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(target.hostname).toBe(`[${IPV6_ADDRESS}]`);
    expect(target.href).toContain(`[${IPV6_ADDRESS}]`);
  });

  it("refuses rather than falling back to the hostname when the address cannot be pinned", async () => {
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946%eth0"]);
    const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response("calendar", { status: 200 })));
    installMockFetch(fetchMock);

    await expect(createSafeFetch(enabledOptions)("https://calendar.example.com/feed.ics")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
