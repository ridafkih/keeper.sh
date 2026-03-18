import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { validateUrlSafety, createSafeFetch, UrlSafetyError } from "./safe-fetch";
import type { SafeFetchOptions } from "./safe-fetch";

const mockResolve4 = mock<(hostname: string) => Promise<string[]>>();
const mockResolve6 = mock<(hostname: string) => Promise<string[]>>();

mock.module("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const enabledOptions: SafeFetchOptions = { blockPrivateResolution: true };

beforeEach(() => {
  mockResolve4.mockReset();
  mockResolve6.mockReset();

  mockResolve6.mockRejectedValue(new Error("no AAAA records"));
});

describe("validateUrlSafety", () => {
  describe("scheme validation (always enforced)", () => {
    it("rejects file:// URLs", async () => {
      await expect(validateUrlSafety("file:///etc/passwd")).rejects.toThrow(UrlSafetyError);
    });

    it("rejects ftp:// URLs", async () => {
      await expect(validateUrlSafety("ftp://server/file")).rejects.toThrow(UrlSafetyError);
    });

    it("rejects data: URLs", async () => {
      await expect(validateUrlSafety("data:text/html,<h1>test</h1>")).rejects.toThrow(UrlSafetyError);
    });

    it("rejects non-http schemes even without blockPrivateResolution", async () => {
      await expect(validateUrlSafety("file:///etc/passwd", {})).rejects.toThrow(UrlSafetyError);
    });
  });

  describe("when blockPrivateResolution is true", () => {
    it("allows http:// URLs with public IPs", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"]);
      await expect(validateUrlSafety("http://example.com/cal.ics", enabledOptions)).resolves.toBeUndefined();
    });

    it("allows https:// URLs with public IPs", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"]);
      await expect(validateUrlSafety("https://example.com/cal.ics", enabledOptions)).resolves.toBeUndefined();
    });

    it("rejects loopback IPv4", async () => {
      await expect(validateUrlSafety("http://127.0.0.1/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects loopback IPv6", async () => {
      await expect(validateUrlSafety("http://[::1]/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects private 10.x.x.x", async () => {
      await expect(validateUrlSafety("http://10.0.0.1/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects private 172.16.x.x", async () => {
      await expect(validateUrlSafety("http://172.16.0.1/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects private 192.168.x.x", async () => {
      await expect(validateUrlSafety("http://192.168.1.1/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects link-local 169.254.x.x (AWS metadata)", async () => {
      await expect(validateUrlSafety("http://169.254.169.254/latest/meta-data/", enabledOptions)).rejects.toThrow(
        UrlSafetyError,
      );
    });

    it("rejects 0.0.0.0", async () => {
      await expect(validateUrlSafety("http://0.0.0.0/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("allows public IP literals", async () => {
      await expect(validateUrlSafety("http://93.184.216.34/cal.ics", enabledOptions)).resolves.toBeUndefined();
    });

    it("rejects hostnames resolving to private IPs", async () => {
      mockResolve4.mockResolvedValue(["192.168.1.1"]);
      await expect(validateUrlSafety("http://evil.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects hostnames resolving to loopback", async () => {
      mockResolve4.mockResolvedValue(["127.0.0.1"]);
      await expect(validateUrlSafety("http://evil.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects if any resolved address is private", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
      await expect(validateUrlSafety("http://mixed.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("allows hostnames resolving to public IPs", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"]);
      await expect(validateUrlSafety("https://calendar.google.com/basic.ics", enabledOptions)).resolves.toBeUndefined();
    });

    it("rejects hostnames that resolve to no addresses", async () => {
      mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
      mockResolve6.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(validateUrlSafety("http://nonexistent.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("checks IPv6 resolution too", async () => {
      mockResolve4.mockRejectedValue(new Error("no A records"));
      mockResolve6.mockResolvedValue(["::1"]);
      await expect(validateUrlSafety("http://ipv6only.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });

    it("rejects IPv4-mapped IPv6 private addresses", async () => {
      mockResolve4.mockRejectedValue(new Error("no A records"));
      mockResolve6.mockResolvedValue(["::ffff:127.0.0.1"]);
      await expect(validateUrlSafety("http://mapped.example.com/", enabledOptions)).rejects.toThrow(UrlSafetyError);
    });
  });

  describe("allowedPrivateHosts", () => {
    it("allows a private IP with port when host:port is in the whitelist", async () => {
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["192.168.1.50:5232"]) };
      await expect(validateUrlSafety("http://192.168.1.50:5232/", options)).resolves.toBeUndefined();
    });

    it("allows a private IP on default port when hostname is in the whitelist", async () => {
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["192.168.1.50"]) };
      await expect(validateUrlSafety("http://192.168.1.50/", options)).resolves.toBeUndefined();
    });

    it("allows a private hostname with port when host:port is in the whitelist", async () => {
      mockResolve4.mockResolvedValue(["10.0.0.5"]);
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["radicale.local:5232"]) };
      await expect(validateUrlSafety("http://radicale.local:5232/", options)).resolves.toBeUndefined();
    });

    it("rejects when port differs from whitelist entry", async () => {
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["192.168.1.50:5232"]) };
      await expect(validateUrlSafety("http://192.168.1.50:9999/", options)).rejects.toThrow(UrlSafetyError);
    });

    it("still rejects private IPs not in the whitelist", async () => {
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["192.168.1.50"]) };
      await expect(validateUrlSafety("http://10.0.0.1/", options)).rejects.toThrow(UrlSafetyError);
    });

    it("still rejects non-http schemes even with whitelist", async () => {
      const options: SafeFetchOptions = { blockPrivateResolution: true, allowedPrivateHosts: new Set(["anything"]) };
      await expect(validateUrlSafety("file:///etc/passwd", options)).rejects.toThrow(UrlSafetyError);
    });
  });

  describe("when blockPrivateResolution is false (default)", () => {
    it("allows private IP literals", async () => {
      await expect(validateUrlSafety("http://192.168.1.1/")).resolves.toBeUndefined();
    });

    it("allows loopback", async () => {
      await expect(validateUrlSafety("http://127.0.0.1/")).resolves.toBeUndefined();
    });

    it("allows hostnames resolving to private IPs", async () => {
      mockResolve4.mockResolvedValue(["10.0.0.1"]);
      await expect(validateUrlSafety("http://radicale.local/")).resolves.toBeUndefined();
    });
  });
});

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const installMockFetch = (mockFn: ReturnType<typeof mock<FetchFn>>): void => {
  Object.assign(globalThis, { fetch: mockFn });
};

describe("createSafeFetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sets redirect to manual", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);

    const mockFetch = mock<FetchFn>();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await safeFetch("https://example.com/cal.ics");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callInit = mockFetch.mock.calls[0]?.[1];
    expect(callInit?.redirect).toBe("manual");
  });

  it("rejects redirects to private IPs", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);

    const mockFetch = mock<FetchFn>();
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      }),
    );
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await expect(safeFetch("https://example.com/cal.ics")).rejects.toThrow(UrlSafetyError);
  });

  it("follows safe redirects", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);

    const mockFetch = mock<FetchFn>();
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: "https://example.com/new-cal.ics" },
      }),
    );
    mockFetch.mockResolvedValueOnce(new Response("calendar data", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    const response = await safeFetch("https://example.com/cal.ics");

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("enforces max redirect depth", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);

    const mockFetch = mock<FetchFn>();
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/redirect" },
        }),
      ),
    );
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch(enabledOptions);
    await expect(safeFetch("https://example.com/cal.ics")).rejects.toThrow("Too many redirects");
  });

  it("rejects initial request to private IP when enabled", async () => {
    const safeFetch = createSafeFetch(enabledOptions);
    await expect(safeFetch("http://10.0.0.1/internal")).rejects.toThrow(UrlSafetyError);
  });

  it("allows private IPs when blockPrivateResolution is false", async () => {
    const mockFetch = mock<FetchFn>();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch();
    const response = await safeFetch("http://10.0.0.1/cal.ics");

    expect(response.status).toBe(200);
  });

  it("allows whitelisted private hosts when enabled", async () => {
    const mockFetch = mock<FetchFn>();
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    installMockFetch(mockFetch);

    const safeFetch = createSafeFetch({ blockPrivateResolution: true, allowedPrivateHosts: new Set(["10.0.0.1"]) });
    const response = await safeFetch("http://10.0.0.1/cal.ics");

    expect(response.status).toBe(200);
  });
});
