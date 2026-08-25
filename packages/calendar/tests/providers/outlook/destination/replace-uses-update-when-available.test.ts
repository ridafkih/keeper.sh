import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import { MICROSOFT_GRAPH_API } from "../../../../src/providers/outlook/shared/api";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";

const MAPPED_EVENT_ID = "AAMkAGViNDU3OWQzLWRlLTQ0";

const changedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-17T19:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-07-17T18:00:00.000Z"),
  summary: "Renamed meeting",
};

const updatedResource = {
  end: { dateTime: "2026-07-17T19:00:00.0000000", timeZone: "UTC" },
  iCalUId: "remote-ical-uid-1",
  id: MAPPED_EVENT_ID,
  start: { dateTime: "2026-07-17T18:00:00.0000000", timeZone: "UTC" },
  subject: "Renamed meeting",
};

const createProvider = (options: {
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
} = {}): CalendarSyncProvider =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "cal-1",
    externalCalendarId: "external-cal-1",
    rateLimiter: options.rateLimiter,
    refreshToken: "test-refresh",
    signal: options.signal,
    userId: "user-1",
  });

describe("an outlook destination updates in place instead of deleting and re-adding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches the event id the mapping points at and issues no delete", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(updatedResource)));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createProvider();

    expect(provider.updateEvents).toBeTypeOf("function");

    const results = await provider.updateEvents?.([
      { deleteId: MAPPED_EVENT_ID, event: changedEvent },
    ]) ?? [];

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchSpy.mock.calls[0] as unknown as [
      string | URL,
      RequestInit,
    ];
    expect(requestUrl.toString()).toBe(`${MICROSOFT_GRAPH_API}/me/events/${MAPPED_EVENT_ID}`);
    expect(requestInit.method).toBe("PATCH");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      subject: "Renamed meeting",
    });

    const methods = (fetchSpy.mock.calls as unknown as [string | URL, RequestInit][])
      .map(([, init]) => init.method);
    expect(methods).not.toContain("DELETE");
    expect(methods).not.toContain("POST");

    expect(results[0]).toMatchObject({ deleteId: MAPPED_EVENT_ID, success: true });
  });

  it("sends the update through the provider request helper so it is metered and abortable", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(updatedResource)));
    vi.stubGlobal("fetch", fetchSpy);
    const acquire = vi.fn(() => Promise.resolve());
    const rateLimiter: RedisRateLimiter = { acquire };
    const controller = new AbortController();
    const provider = createProvider({ rateLimiter, signal: controller.signal });

    await provider.updateEvents?.([{ deleteId: MAPPED_EVENT_ID, event: changedEvent }]);

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(1, controller.signal);
    const [, requestInit] = fetchSpy.mock.calls[0] as unknown as [
      string | URL,
      RequestInit,
    ];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("issues no update request once the sync has already been aborted", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(updatedResource)));
    vi.stubGlobal("fetch", fetchSpy);
    const controller = new AbortController();
    controller.abort(new DOMException("superseded", "AbortError"));
    const provider = createProvider({ signal: controller.signal });

    await expect(
      provider.updateEvents?.([{ deleteId: MAPPED_EVENT_ID, event: changedEvent }]),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
