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
      return new Response(null, { headers: { location }, status: 301 });
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

describe("authorization across a redirect between tenants of a shared hosting suffix", () => {
  it("drops the header when github.io pages change owner", async () => {
    serveRedirectThen("https://attacker.github.io/steal");

    const response = await request("https://victim.github.io/cal.ics");

    expect(attempts.at(1)?.authorization).toBe("");
    expect(getWithheldCredentials(response)).toEqual({
      redirectedTo: "https://attacker.github.io/steal",
    });
  });

  it("drops the header when an S3 bucket redirects to another bucket", async () => {
    serveRedirectThen("https://attacker-bucket.s3.amazonaws.com/steal");

    await request("https://victim-bucket.s3.amazonaws.com/cal.ics");

    expect(attempts.at(1)?.authorization).toBe("");
  });

  it("drops the header when a workers.dev subdomain redirects to another", async () => {
    serveRedirectThen("https://attacker.workers.dev/steal");

    await request("https://victim.workers.dev/cal.ics");

    expect(attempts.at(1)?.authorization).toBe("");
  });
});
