import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

interface RecordedSubRequest {
  method: string;
  path: string;
  body?: unknown;
}

const MAPPED_EVENT_ID = "google-event-id-abc123";

const changedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Renamed meeting",
};

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "cal-1",
  externalCalendarId: "primary",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const recordedRequests = (): RecordedSubRequest[] =>
  batchMocks.executeBatchChunked.mock.calls.flatMap(
    (call) => (call[0] ?? []) as RecordedSubRequest[],
  );

describe("a google destination updates in place instead of deleting and re-adding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchMocks.executeBatchChunked.mockResolvedValue([{
      body: {
        end: { dateTime: "2026-03-15T10:00:00Z" },
        id: MAPPED_EVENT_ID,
        start: { dateTime: "2026-03-15T09:00:00Z" },
        summary: "Renamed meeting",
      },
      headers: {},
      statusCode: 200,
    }]);
  });

  it("rewrites the event the mapping points at and issues no delete", async () => {
    const provider = createProvider();

    expect(provider.updateEvents).toBeTypeOf("function");

    const results = await provider.updateEvents?.([
      { deleteId: MAPPED_EVENT_ID, event: changedEvent },
    ]) ?? [];

    const requests = recordedRequests();
    expect(requests).toHaveLength(1);

    const [updateRequest] = requests;
    expect(updateRequest?.method).toMatch(/^(?:PATCH|PUT)$/);
    expect(updateRequest?.path).toBe(
      `/calendar/v3/calendars/primary/events/${MAPPED_EVENT_ID}`,
    );
    expect(updateRequest?.body).toMatchObject({ summary: "Renamed meeting" });

    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(requests.some((request) => request.path.endsWith("/events/import"))).toBe(false);

    expect(results[0]).toMatchObject({ deleteId: MAPPED_EVENT_ID, success: true });
  });
});
