import { afterEach, describe, expect, it, vi } from "vitest";
import { listUserCalendars } from "../../../../../src/providers/google/source/utils/list-calendars";
import { RequestTimeoutError } from "../../../../../src/core/utils/fetch-with-timeout";
import { createSilentProviderFetch } from "../../../../support/silent-provider-fetch";

const INJECTED_TIMEOUT_MS = 250;

describe("google calendar listing bounds each page with a default timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a request timeout when the caller supplies no signal", async () => {
    const recorded: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) => {
      recorded.push(init);
      return Promise.resolve(Response.json({ items: [], kind: "calendar#calendarList" }));
    });

    await listUserCalendars("access-token");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects instead of hanging when the provider accepts the page request and goes silent", async () => {
    vi.stubGlobal("fetch", createSilentProviderFetch());

    const listing = listUserCalendars("access-token", { requestTimeoutMs: INJECTED_TIMEOUT_MS });

    await expect(listing).rejects.toBeInstanceOf(RequestTimeoutError);
    await expect(listing).rejects.toThrow(`Request timeout after ${INJECTED_TIMEOUT_MS}ms`);
  });

  it("still aborts on a caller-supplied signal that fires before the default timeout", async () => {
    const caller = new AbortController();
    const callerReason = new Error("caller abandoned the google calendar listing");
    vi.stubGlobal("fetch", createSilentProviderFetch({
      onRequest: () => {
        caller.abort(callerReason);
      },
    }));

    const listing = listUserCalendars("access-token", {
      requestTimeoutMs: 60_000,
      signal: caller.signal,
    });

    await expect(listing).rejects.toBe(callerReason);
  });
});
