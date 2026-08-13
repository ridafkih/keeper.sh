import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSafeFetch, getWithheldCredentials } from "../../src/utils/safe-fetch";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const AUTHORIZATION = "Basic dXNlcjpwYXNz";

const requestHref = (input: string | Request | URL): string => {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
};

const redirectTo = (location: string): Response =>
  new Response(null, { headers: { location }, status: 301 });

interface Attempt {
  authorization: string;
  url: string;
}

let attempts: Attempt[] = [];
let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const serveRedirectThen = (location: string): void => {
  const mockFetch = vi.fn<FetchFn>(async (input, init) => {
    const url = requestHref(input);
    attempts.push({ authorization: new Headers(init?.headers).get("authorization") ?? "", url });
    await Promise.resolve();
    if (attempts.length === 1) {
      return redirectTo(location);
    }
    return new Response("body", { status: 200 });
  });
  Object.assign(globalThis, { fetch: mockFetch });
};

const request = (url: string): Promise<Response> =>
  createSafeFetch()(url, { headers: { authorization: AUTHORIZATION } });

beforeEach(() => {
  originalFetch = globalThis.fetch;
  attempts = [];
  mockResolve4.mockReset();
  mockResolve6.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("authorization across redirects", () => {
  it("keeps the header when the same host upgrades plain HTTP to HTTPS", async () => {
    serveRedirectThen("https://caldav.example.test/cal/");

    await request("http://caldav.example.test/cal/");

    expect(attempts.at(1)).toEqual({
      authorization: AUTHORIZATION,
      url: "https://caldav.example.test/cal/",
    });
  });

  it("keeps the header for a same-host upgrade even when the host has no registrable domain", async () => {
    serveRedirectThen("https://192.168.1.50:5232/cal/");

    await request("http://192.168.1.50:5232/cal/");

    expect(attempts.at(1)?.authorization).toBe(AUTHORIZATION);
  });

  it("drops the header when HTTPS is downgraded to plain HTTP", async () => {
    serveRedirectThen("http://caldav.example.test/cal/");

    await request("https://caldav.example.test/cal/");

    expect(attempts.at(1)?.authorization).toBe("");
  });

  it("drops the header when the redirect leaves the site", async () => {
    serveRedirectThen("https://dav.other-provider.test/cal/");

    await request("https://caldav.example.test/cal/");

    expect(attempts.at(1)?.authorization).toBe("");
  });

  it("keeps the header across subdomains of the same registrable domain", async () => {
    serveRedirectThen("https://dav.example.com/cal/");

    await request("https://caldav.example.com/cal/");

    expect(attempts.at(1)?.authorization).toBe(AUTHORIZATION);
  });
});

describe("reporting that credentials were withheld", () => {
  it("marks the response produced after the header was dropped", async () => {
    serveRedirectThen("https://dav.other-provider.test/cal/");

    const response = await request("https://caldav.example.test/cal/");

    expect(getWithheldCredentials(response)).toEqual({
      redirectedTo: "https://dav.other-provider.test/cal/",
    });
  });

  it("leaves a response unmarked when the header survived the redirect", async () => {
    serveRedirectThen("https://caldav.example.test/other/");

    const response = await request("https://caldav.example.test/cal/");

    expect(getWithheldCredentials(response)).toBeNull();
  });

  it("leaves a response unmarked when the request carried no credentials", async () => {
    serveRedirectThen("https://dav.other-provider.test/cal/");

    const response = await createSafeFetch()("https://caldav.example.test/cal/");

    expect(getWithheldCredentials(response)).toBeNull();
  });
});
