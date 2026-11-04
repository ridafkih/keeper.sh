import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";
import { graphBatchReply, readBatchRequests, throttledSubResponse } from "./graph-batch-fixtures";
import type { GraphSubRequest } from "./graph-batch-fixtures";

const createProvider = (rateLimiter?: RedisRateLimiter) =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "cal-1",
    externalCalendarId: "external-cal-1",
    rateLimiter,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const createEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-17T19:00:00.000Z"),
  id: `event-state-id-${index}`,
  sourceEventUid: `source-event-uid-${index}`,
  startTime: new Date("2026-07-17T18:00:00.000Z"),
  summary: `Meeting ${index}`,
});

const createdReplyFor = (requests: GraphSubRequest[]): Response =>
  Response.json({
    responses: requests.toReversed().map((request) => ({
      body: {
        iCalUId: `uid-${(request.body as { subject: string }).subject}`,
        id: `remote-${(request.body as { subject: string }).subject}`,
      },
      headers: {},
      id: request.id,
      status: 201,
    })),
  });

const replyToEveryBatchWithCreations = () =>
  vi.fn((_input: string | URL | Request, init?: RequestInit) => {
    const { requests } = JSON.parse(String(init?.body)) as { requests: GraphSubRequest[] };
    return Promise.resolve(createdReplyFor(requests));
  });

describe("Outlook destination writes through Graph JSON batching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates events in $batch calls of at most twenty sub-requests", async () => {
    const fetchMock = replyToEveryBatchWithCreations();
    vi.stubGlobal("fetch", fetchMock);
    const events = Array.from({ length: 45 }, (_entry, index) => createEvent(index));

    const results = await createProvider().pushEvents(events);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(String(input)).toBe("https://graph.microsoft.com/v1.0/$batch");
      expect(init.method).toBe("POST");
    }
    expect([0, 1, 2].map((call) => readBatchRequests(fetchMock, call).length)).toEqual([20, 20, 5]);
    const [firstSubRequest] = readBatchRequests(fetchMock, 0);
    expect(firstSubRequest).toMatchObject({
      headers: { "Content-Type": "application/json", Prefer: 'outlook.body-content-type="text"' },
      method: "POST",
      url: "/me/calendars/external-cal-1/events",
    });
    expect(firstSubRequest?.body).toMatchObject({ subject: "Meeting 0" });
    expect(results).toHaveLength(45);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it("maps each sub-response back to its event by id when Graph answers out of order", async () => {
    vi.stubGlobal("fetch", replyToEveryBatchWithCreations());
    const events = Array.from({ length: 3 }, (_entry, index) => createEvent(index));

    const results = await createProvider().pushEvents(events);

    expect(results).toMatchObject([
      { deleteId: "remote-Meeting 0", remoteId: "uid-Meeting 0", success: true },
      { deleteId: "remote-Meeting 1", remoteId: "uid-Meeting 1", success: true },
      { deleteId: "remote-Meeting 2", remoteId: "uid-Meeting 2", success: true },
    ]);
  });

  it("acquires one rate limiter slot per sub-request in each batch", async () => {
    const acquire = vi.fn((_count: number, _signal?: AbortSignal) => Promise.resolve());
    vi.stubGlobal("fetch", replyToEveryBatchWithCreations());

    await createProvider({ acquire }).pushEvents(
      Array.from({ length: 25 }, (_entry, index) => createEvent(index)),
    );

    expect(acquire.mock.calls.map((call) => call[0])).toEqual([20, 5]);
  });

  it("resends only the throttled sub-requests and keeps the others' results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(graphBatchReply(
        { body: { iCalUId: "uid-0", id: "remote-0" }, status: 201 },
        throttledSubResponse(429, "0"),
        { body: { error: { message: "Invalid event payload." } }, status: 400 },
      ))
      .mockImplementationOnce((_input: string | URL | Request, init?: RequestInit) => {
        const { requests } = JSON.parse(String(init?.body)) as { requests: GraphSubRequest[] };
        return Promise.resolve(createdReplyFor(requests));
      });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    const results = await provider.pushEvents([createEvent(0), createEvent(1), createEvent(2)]);

    expect(readBatchRequests(fetchMock, 1).map((request) => request.id)).toEqual(["1"]);
    expect(results).toEqual([
      expect.objectContaining({ deleteId: "remote-0", success: true }),
      expect.objectContaining({ deleteId: "remote-Meeting 1", success: true }),
      {
        error: "Invalid event payload.",
        errorType: "MicrosoftGraphHttpError",
        statusCode: 400,
        success: false,
      },
    ]);
    expect(provider.getThrottleMetrics().retryCount).toBe(1);
  });

  it("waits for the longest sub-response Retry-After before resending a throttled batch", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(graphBatchReply(
        throttledSubResponse(429, "0.02"),
        throttledSubResponse(503, "0.06"),
      ))
      .mockImplementationOnce((_input: string | URL | Request, init?: RequestInit) => {
        const { requests } = JSON.parse(String(init?.body)) as { requests: GraphSubRequest[] };
        return Promise.resolve(createdReplyFor(requests));
      });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    const results = await provider.pushEvents([createEvent(0), createEvent(1)]);

    expect(results.every((result) => result.success)).toBe(true);
    expect(provider.getThrottleMetrics()).toEqual({ retryAfterMs: 60, retryCount: 2 });
  });

  it("retries a sub-request that timed out at the gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(graphBatchReply({ headers: { "Retry-After": "0" }, status: 504 }))
      .mockResolvedValueOnce(graphBatchReply({ body: { iCalUId: "uid", id: "remote" }, status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await createProvider().pushEvents([createEvent(0)]);

    expect(result).toMatchObject({ deleteId: "remote", success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a throttled $batch call as a whole after its Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(
        { error: { code: "TooManyRequests", message: "Please retry again later." } },
        { headers: { "Retry-After": "0" }, status: 429 },
      ))
      .mockResolvedValueOnce(graphBatchReply({ body: { iCalUId: "uid", id: "remote" }, status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();

    const [result] = await provider.pushEvents([createEvent(0)]);

    expect(result).toMatchObject({ deleteId: "remote", success: true });
    expect(provider.getThrottleMetrics().retryCount).toBe(1);
  });

  it("fails every event in a $batch call Graph rejects outright", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(
      { error: { code: "BadRequest", message: "Invalid batch payload." } },
      { status: 400 },
    ))));

    const results = await createProvider().pushEvents([createEvent(0), createEvent(1)]);

    expect(results).toEqual([0, 1].map(() => ({
      error: "Invalid batch payload.",
      errorType: "MicrosoftGraphHttpError",
      statusCode: 400,
      success: false,
    })));
  });

  it("fails a sub-request Graph leaves out of the batch response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ responses: [] }))));

    const [result] = await createProvider().pushEvents([createEvent(0)]);

    expect(result).toMatchObject({ errorType: "MicrosoftGraphBatchError", success: false });
  });

  it("deletes events in $batch calls and keeps per-item outcomes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(graphBatchReply(
      { status: 204 },
      { status: 404 },
      { body: { error: { message: "Access is denied." } }, status: 403 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const results = await createProvider().deleteEvents(["a", "b", "c"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readBatchRequests(fetchMock, 0).map((request) => request.url)).toEqual([
      "/me/events/a/permanentDelete",
      "/me/events/b/permanentDelete",
      "/me/events/c/permanentDelete",
    ]);
    expect(results).toEqual([
      { success: true },
      { success: true },
      { error: "Access is denied.", errorType: "MicrosoftGraphHttpError", statusCode: 403, success: false },
    ]);
  });
});
