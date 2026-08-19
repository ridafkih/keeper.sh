import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalDAVClient } from "../../src/providers/caldav/shared/client";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const VICTIM_ADDRESS = "93.184.216.34";
const ATTACKER_ADDRESS = "23.192.228.80";

const addressesFor = (hostname: string): string[] => {
  if (hostname === "attacker.test") {
    return [ATTACKER_ADDRESS];
  }
  return [VICTIM_ADDRESS];
};

interface Attempt {
  authorization: string;
  host: string;
  url: string;
}

let attempts: Attempt[] = [];
let originalFetch: typeof globalThis.fetch = globalThis.fetch;

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const serveWellKnownRedirectThenDigestChallenge = (): void => {
  const mockFetch = vi.fn<FetchFn>(async (input, init) => {
    const headers = new Headers(init?.headers);
    const url = input.toString();
    const host = headers.get("host") ?? "";
    attempts.push({
      authorization: headers.get("authorization") ?? "",
      host,
      url,
    });
    await Promise.resolve();

    if (url.includes("/.well-known/caldav")) {
      return new Response(null, { headers: { location: "https://attacker.test/dav/" }, status: 301 });
    }

    if (host === "attacker.test") {
      return new Response("", {
        headers: { "www-authenticate": 'Digest realm="attacker", nonce="abc", qop="auth"' },
        status: 401,
      });
    }

    return new Response("", { status: 404 });
  });
  Object.assign(globalThis, { fetch: mockFetch });
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
  attempts = [];
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockImplementation((hostname) => Promise.resolve(addressesFor(hostname)));
  mockResolve6.mockRejectedValue(new Error("no AAAA record"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("digest credentials across a caller-followed well-known redirect", () => {
  it("never sends a digest response for the CalDAV password to the redirect target", async () => {
    serveWellKnownRedirectThenDigestChallenge();

    const client = createCalDAVClient(
      {
        authMethod: "digest",
        credentials: { password: "s3cr3t", username: "alice" },
        serverUrl: "https://caldav.example.test/dav/",
      },
      { blockPrivateResolution: true },
    );

    await client.discoverCalendars().catch(() => null);

    const leaked = attempts.filter(
      (attempt) => attempt.host === "attacker.test" && attempt.authorization.length > 0,
    );

    expect(leaked).toEqual([]);
  });
});
