import { describe, expect, test } from "vitest";
import { createAuthenticatingFetch } from "../../src/client/authenticating-fetch";
import type { CalDAVAuthMethod } from "../../src/dependencies";
import { credentials } from "../support/harness";

const resolved: CalDAVAuthMethod[] = [];

const ignoreResolvedMethod = (method: CalDAVAuthMethod): void => {
  resolved.push(method);
};

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("the authentication probe is neither a hang nor a poison pill", () => {
  test("DAV-L20: a request carrying an aborted signal rejects even though the probe never answers", async () => {
    const stalling: typeof fetch = Object.assign(
      () => Promise.withResolvers<Response>().promise,
      { preconnect: (): Promise<void> => Promise.resolve() },
    );
    const authenticating = createAuthenticatingFetch({
      fetch: stalling,
      credentials,
      onAuthMethodResolved: ignoreResolvedMethod,
    });

    await expect(
      authenticating("https://dav.example.com/calendars/", { signal: abortedSignal() }),
    ).rejects.toBeDefined();
  }, 30_000);

  test("DAV-L20: a probe that failed once does not fail every request that follows it", async () => {
    let probes = 0;
    const flaky: typeof fetch = Object.assign(
      (unused: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== "OPTIONS") {
          return Promise.resolve(new Response("served", { status: 207 }));
        }
        probes += 1;
        if (probes === 1) {
          return Promise.reject(new TypeError("the socket dropped"));
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      },
      { preconnect: (): Promise<void> => Promise.resolve() },
    );
    const authenticating = createAuthenticatingFetch({
      fetch: flaky,
      credentials,
      onAuthMethodResolved: ignoreResolvedMethod,
    });

    await expect(authenticating("https://dav.example.com/calendars/")).rejects.toBeDefined();
    const recovered = await authenticating("https://dav.example.com/calendars/");

    expect(recovered.status).toBe(207);
    expect(probes).toBe(2);
  }, 30_000);
});
