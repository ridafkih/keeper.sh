import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const createProvider = (options: {
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
} = {}) => createGoogleSyncProvider({
  accessToken: "test-token",
  refreshToken: "test-refresh",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  externalCalendarId: "primary",
  calendarId: "cal-1",
  userId: "user-1",
  rateLimiter: options.rateLimiter,
  signal: options.signal,
});

const batchResponse = (statusCode: number, body: unknown) => ({
  body,
  headers: {},
  statusCode,
});

describe("createGoogleSyncProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", () => {
    const provider = createProvider();

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });

  it("checkpoints the iCalUID and Google event ID returned by import", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { id: "google-event-id" }),
    ]);

    const [result] = await createProvider().pushEvents([{
      calendarId: "source-calendar",
      calendarName: "Source",
      calendarUrl: null,
      endTime: new Date("2026-03-15T10:00:00Z"),
      id: "event-state-id",
      sourceEventUid: "source-event-uid",
      startTime: new Date("2026-03-15T09:00:00Z"),
      summary: "Meeting",
    }]);

    expect(result).toMatchObject({
      deleteId: "google-event-id",
      remoteId: expect.stringContaining("@keeper.sh"),
      success: true,
    });
  });

  it("converges when import and listing use Google's two different identifiers", async () => {
    const event: MaterializedSyncableEvent = {
      calendarId: "source-calendar",
      calendarName: "Source",
      calendarUrl: null,
      endTime: new Date("2026-03-15T10:00:00Z"),
      id: "event-state-id",
      sourceEventUid: "source-event-uid",
      startTime: new Date("2026-03-15T09:00:00Z"),
      summary: "Meeting",
    };
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { id: "google-event-id" }),
    ]);
    const provider = createProvider();
    const [pushResult] = await provider.pushEvents([event]);
    if (!pushResult?.success || !pushResult.remoteId || !pushResult.deleteId) {
      throw new Error("Expected a successful Google import");
    }
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
      items: [{
        end: { dateTime: event.endTime.toISOString() },
        iCalUID: pushResult.remoteId,
        id: pushResult.deleteId,
        start: { dateTime: event.startTime.toISOString() },
        summary: event.summary,
      }],
    }, { status: 200 }))));

    const remoteEvents = await provider.listRemoteEvents({
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });
    const mapping = {
      calendarId: "cal-1",
      deleteIdentifier: pushResult.deleteId,
      destinationEventUid: pushResult.remoteId,
      endTime: event.endTime,
      eventStateId: event.id,
      id: "mapping-id",
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    };

    expect(computeSyncOperations([event], [mapping], remoteEvents)).toEqual({
      mappingIdsToPrune: [],
      operations: [],
      staleMappingIds: [],
    });
  });

  it("lists every far-future Keeper event page with one fixed lower boundary and no upper bound", async () => {
    const timeMin = new Date("2026-07-10T00:00:00.000Z");
    const farFutureStart = "2040-03-15T09:00:00.000Z";
    const farFutureEnd = "2040-03-15T10:00:00.000Z";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        items: [{
          end: { dateTime: farFutureEnd },
          iCalUID: "canonical@keeper.sh",
          id: "canonical-id",
          start: { dateTime: farFutureStart },
        }, {
          end: { dateTime: farFutureEnd },
          iCalUID: "user-event@example.com",
          id: "user-event-id",
          start: { dateTime: farFutureStart },
        }],
        nextPageToken: "page-2",
      }))
      .mockResolvedValueOnce(Response.json({
        items: [{
          end: { dateTime: farFutureEnd },
          iCalUID: "duplicate@keeper.sh",
          id: "duplicate-id",
          start: { dateTime: farFutureStart },
        }],
      }));
    const acquire = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchMock);

    const remoteEvents = await createProvider({ rateLimiter: { acquire } })
      .listRemoteEvents({ timeMin });

    expect(remoteEvents.map((event) => event.deleteId)).toEqual([
      "canonical-id",
      "duplicate-id",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get("timeMin")).toBe(timeMin.toISOString());
    expect(secondUrl.searchParams.get("timeMin")).toBe(timeMin.toISOString());
    expect(firstUrl.searchParams.has("timeMax")).toBe(false);
    expect(secondUrl.searchParams.has("timeMax")).toBe(false);
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("passes cancellation to the rate limiter before listing a page", async () => {
    const controller = new AbortController();
    const abortError = new Error("job deadline exceeded");
    const acquire = vi.fn((_count: number, signal?: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pending = createProvider({
      rateLimiter: { acquire },
      signal: controller.signal,
    }).listRemoteEvents({ timeMin: new Date("2026-07-10T00:00:00.000Z") });
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith(1, controller.signal);
    });
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not checkpoint an import response without its Google event ID", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, {}),
    ]);

    await expect(createProvider().pushEvents([{
      calendarId: "source-calendar",
      calendarName: "Source",
      calendarUrl: null,
      endTime: new Date("2026-03-15T10:00:00Z"),
      id: "event-state-id",
      sourceEventUid: "source-event-uid",
      startTime: new Date("2026-03-15T09:00:00Z"),
      summary: "Meeting",
    }])).resolves.toEqual([{
      error: "Google import response is missing the event ID",
      errorType: "GoogleBatchProtocolError",
      statusCode: 200,
      success: false,
    }]);
  });

  it.each([{ items: [] }, {}])(
    "treats a valid empty lookup response as an already-absent event",
    async (body) => {
      batchMocks.executeBatchChunked.mockResolvedValueOnce([
        batchResponse(200, body),
      ]);

      await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
        { success: true },
      ]);
      expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
    },
  );

  it("deletes the event ID returned by a valid lookup response", async () => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([batchResponse(200, { items: [{ id: "google-event-id" }] })])
      .mockResolvedValueOnce([batchResponse(204, null)]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      { success: true },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(2);
    expect(batchMocks.executeBatchChunked.mock.calls[1]?.[0]).toEqual([
      {
        method: "DELETE",
        path: "/calendar/v3/calendars/primary/events/google-event-id",
      },
    ]);
  });

  it.each([401, 403, 404, 429, 503])(
    "retains the mapping when the lookup returns HTTP %i",
    async (statusCode) => {
      batchMocks.executeBatchChunked.mockResolvedValueOnce([
        batchResponse(statusCode, { error: { message: "lookup failed" } }),
      ]);

      await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
        {
          error: "lookup failed",
          errorType: "GoogleCalendarApiError",
          statusCode,
          success: false,
        },
      ]);
      expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the mapping when a successful lookup has an invalid body", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: "not-an-array" }),
    ]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      {
        error: "Invalid Google event lookup response",
        errorType: "GoogleBatchProtocolError",
        statusCode: 200,
        success: false,
      },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
  });

  it("retains the mapping when the lookup batch response is missing", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      {
        error: "Missing batch response for Google event lookup",
        errorType: "GoogleBatchProtocolError",
        success: false,
      },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])("treats HTTP %i from the actual delete as success", async (statusCode) => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([batchResponse(200, { items: [{ id: "google-event-id" }] })])
      .mockResolvedValueOnce([batchResponse(statusCode, { error: { message: "gone" } })]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      { success: true },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(2);
  });

  it("retains the mapping when the lookup response is ambiguous", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [{ id: "first" }, { id: "second" }] }),
    ]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      {
        error: "Google event lookup returned 2 matching events",
        errorType: "GoogleBatchProtocolError",
        statusCode: 200,
        success: false,
      },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
  });

  it("retains the mapping when the lookup match has no event ID", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(200, { items: [{ summary: "No identifier" }] }),
    ]);

    await expect(createProvider().deleteEvents(["keeper-event@keeper.sh"])).resolves.toEqual([
      {
        error: "Google event lookup response is missing the event ID",
        errorType: "GoogleBatchProtocolError",
        statusCode: 200,
        success: false,
      },
    ]);
    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
  });
});
