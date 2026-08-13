import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";
import { KEEPER_CATEGORY } from "@keeper.sh/constants";

const createProvider = (options: {
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
} = {}) =>
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

const throttledResponse = (status: number, retryAfter: string): Response =>
  Response.json(
    { error: { code: "ApplicationThrottled", message: "Application is over its MailboxConcurrency limit." } },
    { headers: { "Retry-After": retryAfter }, status },
  );

const createEvent = (): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-17T19:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-07-17T18:00:00.000Z"),
  summary: "Meeting",
});

const installAbortableFetch = (): void => {
  vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
};

describe("createOutlookSyncProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", () => {
    const provider = createProvider();

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });

  it("aborts a pending Graph event creation", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider({ signal: controller.signal });
    const abortError = new Error("job deadline exceeded");

    const pending = provider.pushEvents([createEvent()]);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("accepts a null series master ID when Graph creates a standalone event", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      iCalUId: "created-event-uid",
      id: "created-event-id",
      seriesMasterId: null,
      type: "singleInstance",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().pushEvents([createEvent()])).resolves.toEqual([{
      deleteId: "created-event-id",
      echo: { comparable: false, reason: "echo-times-missing" },
      remoteId: "created-event-uid",
      success: true,
    }]);
  });

  it("compares the creation echo field by field and requests a text body echo", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      body: { content: "agenda", contentType: "text" },
      end: { dateTime: "2026-07-17T19:00:00.0000000", timeZone: "UTC" },
      iCalUId: "created-event-uid",
      id: "created-event-id",
      isAllDay: false,
      showAs: "busy",
      start: { dateTime: "2026-07-17T18:00:00.0000000", timeZone: "UTC" },
      subject: "Meeting",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await createProvider().pushEvents([{
      ...createEvent(),
      description: "agenda",
    }]);

    expect(result?.echo).toEqual({
      comparable: true,
      divergence: {
        allDay: false,
        description: false,
        end: false,
        location: false,
        start: false,
        summary: false,
      },
    });
    const [, requestInit] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(new Headers(requestInit.headers).get("Prefer")).toContain(
      'outlook.body-content-type="text"',
    );
  });

  it("names the fields the creation echo rewrote", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      body: { content: "agenda rewritten", contentType: "text" },
      end: { dateTime: "2026-07-17T19:30:00.0000000", timeZone: "UTC" },
      iCalUId: "created-event-uid",
      id: "created-event-id",
      isAllDay: false,
      showAs: "busy",
      start: { dateTime: "2026-07-17T18:00:00.0000000", timeZone: "UTC" },
      subject: "Meeting",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await createProvider().pushEvents([{
      ...createEvent(),
      description: "agenda",
    }]);

    expect(result?.echo).toEqual({
      comparable: true,
      divergence: {
        allDay: false,
        description: true,
        end: true,
        location: false,
        start: false,
        summary: false,
      },
    });
  });

  it("marks a non-text body echo as uncomparable instead of diffing across formats", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      body: { content: "<html><body>agenda</body></html>", contentType: "html" },
      end: { dateTime: "2026-07-17T19:00:00.0000000", timeZone: "UTC" },
      iCalUId: "created-event-uid",
      id: "created-event-id",
      isAllDay: false,
      showAs: "busy",
      start: { dateTime: "2026-07-17T18:00:00.0000000", timeZone: "UTC" },
      subject: "Meeting",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await createProvider().pushEvents([{
      ...createEvent(),
      description: "agenda",
    }]);

    expect(result?.success).toBe(true);
    expect(result?.echo).toEqual({ comparable: false, reason: "echo-body-not-text" });
  });

  it("aborts a pending Graph event deletion", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider({ signal: controller.signal });
    const abortError = new Error("job deadline exceeded");

    const pending = provider.deleteEvents(["outlook-event-id"]);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("aborts a pending Graph event listing request", async () => {
    installAbortableFetch();
    const controller = new AbortController();
    const provider = createProvider({ signal: controller.signal });
    const abortError = new Error("job deadline exceeded");

    const pending = provider.listRemoteEvents({
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce(); });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("requests plain-text bodies when listing events for content reconciliation", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ value: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().listRemoteEvents({
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Prefer: `outlook.body-content-type="text"`,
      },
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("$filter")).toContain("end/dateTime ge");
    expect(requestUrl.searchParams.get("$filter")).not.toContain("start/dateTime le");
  });

  it("pages through far-future Keeper events without a future cutoff", async () => {
    const timeMin = new Date("2026-07-10T00:00:00.000Z");
    const nextLink = "https://graph.microsoft.com/v1.0/me/events?$skiptoken=page-2";
    const eventTime = {
      end: { dateTime: "2040-03-15T10:00:00.000Z", timeZone: "UTC" },
      start: { dateTime: "2040-03-15T09:00:00.000Z", timeZone: "UTC" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        "@odata.nextLink": nextLink,
        value: [{
          ...eventTime,
          categories: [KEEPER_CATEGORY],
          iCalUId: "canonical-uid",
          id: "canonical-id",
        }],
      }))
      .mockResolvedValueOnce(Response.json({
        value: [{
          ...eventTime,
          categories: [KEEPER_CATEGORY],
          iCalUId: "duplicate-uid",
          id: "duplicate-id",
        }, {
          ...eventTime,
          categories: [],
          iCalUId: "mapped-but-untagged-uid",
          id: "mapped-but-untagged-id",
        }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const remoteEvents = await createProvider().listRemoteEvents({ timeMin });

    expect(remoteEvents.map((event) => ({
      deleteId: event.deleteId,
      isKeeperEvent: event.isKeeperEvent,
    }))).toEqual([
      { deleteId: "canonical-id", isKeeperEvent: true },
      { deleteId: "duplicate-id", isKeeperEvent: true },
      { deleteId: "mapped-but-untagged-id", isKeeperEvent: false },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const initialUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const filter = initialUrl.searchParams.get("$filter") ?? "";
    expect(filter).not.toContain("categories");
    expect(filter).toContain(`end/dateTime ge '${timeMin.toISOString()}'`);
    expect(filter).not.toContain("start/dateTime le");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(nextLink);
  });

  it("canonicalizes named-timezone all-day responses to date-only UTC instants", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      value: [{
        categories: [KEEPER_CATEGORY],
        end: { dateTime: "2026-03-09T00:00:00.0000000", timeZone: "Mountain Standard Time" },
        iCalUId: "all-day-uid",
        id: "all-day-id",
        isAllDay: true,
        start: { dateTime: "2026-03-08T00:00:00.0000000", timeZone: "Mountain Standard Time" },
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [event] = await createProvider().listRemoteEvents({
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(event).toMatchObject({
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    });
  });

  it("reads a remote calendar containing an event with a null subject", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      value: [
        {
          categories: [KEEPER_CATEGORY],
          end: { dateTime: "2026-03-08T19:00:00.0000000", timeZone: "UTC" },
          iCalUId: "titled-uid",
          id: "titled-id",
          start: { dateTime: "2026-03-08T18:00:00.0000000", timeZone: "UTC" },
          subject: "Titled",
        },
        {
          categories: [KEEPER_CATEGORY],
          end: { dateTime: "2026-03-09T19:00:00.0000000", timeZone: "UTC" },
          iCalUId: "untitled-uid",
          id: "untitled-id",
          start: { dateTime: "2026-03-09T18:00:00.0000000", timeZone: "UTC" },
          subject: null,
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await createProvider().listRemoteEvents({
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(events.map((event) => event.uid)).toEqual(["titled-uid", "untitled-uid"]);
  });

  it("retries a throttled event creation after the Retry-After delay and reports success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(throttledResponse(429, "0.05"))
      .mockResolvedValueOnce(Response.json({
        iCalUId: "created-event-uid",
        id: "created-event-id",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    await expect(provider.pushEvents([createEvent()])).resolves.toEqual([{
      deleteId: "created-event-id",
      echo: { comparable: false, reason: "echo-times-missing" },
      remoteId: "created-event-uid",
      success: true,
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider.getThrottleMetrics()).toEqual({ retryAfterMs: 50, retryCount: 1 });
  });

  it("retries a MailboxConcurrency 503 before giving up on the occurrence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(throttledResponse(503, "0"))
      .mockResolvedValueOnce(throttledResponse(503, "0"))
      .mockResolvedValueOnce(Response.json({
        iCalUId: "created-event-uid",
        id: "created-event-id",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    const [result] = await provider.pushEvents([createEvent()]);

    expect(result).toEqual({
      deleteId: "created-event-id",
      echo: { comparable: false, reason: "echo-times-missing" },
      remoteId: "created-event-uid",
      success: true,
    });
    expect(provider.getThrottleMetrics().retryCount).toBe(2);
  });

  it("reports an occurrence that stays throttled through every retry", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(throttledResponse(429, "0")));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    const [result] = await provider.pushEvents([createEvent()]);

    expect(result).toMatchObject({
      errorType: "OutlookThrottledError",
      statusCode: 429,
      success: false,
    });
    expect(result?.error).toContain("MailboxConcurrency");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("reports a non-throttle write failure without retrying it", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(
      { error: { code: "ErrorInvalidItem", message: "Invalid event payload." } },
      { status: 400 },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    await expect(provider.pushEvents([createEvent()])).resolves.toEqual([{
      error: "Invalid event payload.",
      errorType: "MicrosoftGraphHttpError",
      statusCode: 400,
      success: false,
    }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(provider.getThrottleMetrics().retryCount).toBe(0);
  });

  it("paces bulk pushes through the rate limiter, one slot per request", async () => {
    const acquire = vi.fn((_count: number, _signal?: AbortSignal) => Promise.resolve());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(throttledResponse(429, "0"))
      .mockImplementation(() => Promise.resolve(Response.json({ iCalUId: "uid", id: "id" })));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider({ rateLimiter: { acquire } }).pushEvents([createEvent(), createEvent()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(acquire.mock.calls.map((call) => call[0])).toEqual([1, 1, 1]);
  });

  it("retries a throttled delete rather than dropping it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(throttledResponse(429, "0"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider().deleteEvents(["outlook-event-id"])).resolves.toEqual([
      { success: true },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
