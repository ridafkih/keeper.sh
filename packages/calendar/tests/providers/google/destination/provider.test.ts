import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const createProvider = () => createGoogleSyncProvider({
  accessToken: "test-token",
  refreshToken: "test-refresh",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  externalCalendarId: "primary",
  calendarId: "cal-1",
  userId: "user-1",
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

  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", () => {
    const provider = createProvider();

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
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
