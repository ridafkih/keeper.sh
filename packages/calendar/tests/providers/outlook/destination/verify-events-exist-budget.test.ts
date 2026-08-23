import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";

const createProvider = (options: { rateLimiter?: RedisRateLimiter; signal?: AbortSignal } = {}) =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: "external-cal-1",
    calendarId: "cal-1",
    userId: "user-1",
    rateLimiter: options.rateLimiter,
    signal: options.signal,
  });

const existingEvent = (deleteId: string) => ({
  end: { dateTime: "2026-07-17T19:00:00.0000000", timeZone: "UTC" },
  iCalUId: `uid-${deleteId}`,
  id: deleteId,
  start: { dateTime: "2026-07-17T18:00:00.0000000", timeZone: "UTC" },
});

describe("verification obeys the limiter, timeout and abort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acquires a rate limiter slot for every verification request", async () => {
    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const deleteId = input.toString().split("/me/events/")[1]?.split("?")[0] ?? "";
      return Promise.resolve(Response.json(existingEvent(deleteId)));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const acquire = vi.fn(() => Promise.resolve());
    const rateLimiter: RedisRateLimiter = { acquire };

    const verified = await createProvider({ rateLimiter }).verifyEventsExist([
      "first-id",
      "second-id",
    ]);

    expect(verified).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("carries a request timeout signal on every verification request", async () => {
    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const deleteId = input.toString().split("/me/events/")[1]?.split("?")[0] ?? "";
      return Promise.resolve(Response.json(existingEvent(deleteId)));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await createProvider().verifyEventsExist(["first-id", "second-id"]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchSpy.mock.calls as unknown as [unknown, RequestInit][]) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("issues no verification request once the sync has already been aborted", async () => {
    const fetchSpy = vi.fn((input: string | URL | Request) => {
      const deleteId = input.toString().split("/me/events/")[1]?.split("?")[0] ?? "";
      return Promise.resolve(Response.json(existingEvent(deleteId)));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const acquire = vi.fn(() => Promise.resolve());
    const rateLimiter: RedisRateLimiter = { acquire };
    const controller = new AbortController();
    controller.abort(new DOMException("superseded", "AbortError"));

    const provider = createProvider({ rateLimiter, signal: controller.signal });

    await expect(
      provider.verifyEventsExist(["first-id", "second-id", "third-id"]),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("stops issuing verification requests as soon as the sync aborts mid-loop", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn((input: string | URL | Request) => {
      controller.abort(new DOMException("superseded", "AbortError"));
      const deleteId = input.toString().split("/me/events/")[1]?.split("?")[0] ?? "";
      return Promise.resolve(Response.json(existingEvent(deleteId)));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createProvider({ signal: controller.signal });

    await expect(
      provider.verifyEventsExist(["first-id", "second-id", "third-id"]),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
