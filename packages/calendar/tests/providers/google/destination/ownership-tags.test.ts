import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
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

const MEETING = {
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "event-state-id",
  sourceEventUid: "source-event-uid",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Meeting",
};

describe("Google destination ownership tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tags every imported event with the destination calendar id", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([batchResponse(200, { id: "google-event-id" })]);

    await createProvider().pushEvents([MEETING]);

    const requests = batchMocks.executeBatchChunked.mock.calls[0]?.[0];
    expect(requests?.[0]?.body?.extendedProperties).toEqual({ private: { keeperDestination: "cal-1" } });
  });

  it("reads the tag of each listed Keeper.sh event, and null when it has none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({
      items: [{
        end: { dateTime: "2026-03-15T10:00:00Z" },
        extendedProperties: { private: { keeperDestination: "other-destination" } },
        iCalUID: "theirs@keeper.sh",
        id: "theirs-id",
        start: { dateTime: "2026-03-15T09:00:00Z" },
      }, {
        end: { dateTime: "2026-03-15T10:00:00Z" },
        iCalUID: "legacy@keeper.sh",
        id: "legacy-id",
        start: { dateTime: "2026-03-15T09:00:00Z" },
      }],
    })));

    const remoteEvents = await createProvider().listRemoteEvents({
      timeMax: new Date("2027-01-01T00:00:00Z"),
      timeMin: new Date("2026-01-01T00:00:00Z"),
    });

    expect(remoteEvents.map((event) => event.ownerTag)).toEqual(["other-destination", null]);
  });

  it("claims an existing mirror by patching only its tag", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([batchResponse(200, { id: "google-event-id" })]);

    const [result] = await createProvider().claimEvents([{ deleteId: "google-event-id", event: MEETING }]);

    const requests = batchMocks.executeBatchChunked.mock.calls[0]?.[0];
    expect(result?.success).toBe(true);
    expect(requests).toEqual([expect.objectContaining({
      body: { extendedProperties: { private: { keeperDestination: "cal-1" } } },
      method: "PATCH",
      path: "/calendar/v3/calendars/primary/events/google-event-id",
    })]);
  });
});
