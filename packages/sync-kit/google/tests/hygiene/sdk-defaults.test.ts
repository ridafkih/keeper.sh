import { auth } from "@googleapis/calendar";
import { describe, expect, test } from "vitest";
import { createGoogleClient } from "../../src/client/calendar-client";

const constructedClient = () =>
  createGoogleClient({
    fetch: () => Promise.reject(new Error("the hygiene test never sends a request")),
    auth: new auth.OAuth2({ clientId: "fake", clientSecret: "fake" }),
    timeoutMs: 7500,
  });

describe("the SDK's own defaults are the lockup, and are switched off", () => {
  test("GOOG-L1: the constructed client disables gaxios retries and sets a timeout", () => {
    const client = constructedClient();

    expect(client.context._options.retryConfig?.retry).toBe(0);
    expect(client.context._options.timeout).toBe(7500);
  });

  test("GOOG-L1: the client sends through the injected fetch, never the ambient one", () => {
    const client = constructedClient();

    expect(client.context._options.fetchImplementation).toBeDefined();
    expect(client.context._options.fetchImplementation).not.toBe(globalThis.fetch);
  });

  test("GOOG-L1: no destructive method is left in the SDK's retry list", () => {
    const client = constructedClient();

    expect(client.context._options.retryConfig?.httpMethodsToRetry ?? []).toEqual([]);
  });
});
