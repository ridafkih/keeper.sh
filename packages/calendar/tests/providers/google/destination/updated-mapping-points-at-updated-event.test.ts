import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../../src/core/sync/operations";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent, SyncOperation } from "../../../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const EXTERNAL_CALENDAR_ID = "primary";
const MAPPING_ID = "map-1";
const GOOGLE_EVENT_ID = "googleeventidabc123";
const LIVE_EVENT_STATE_ID = "ev-1";
const REMOTE_ICAL_UID = generateDeterministicEventUid(`ev-0:${EXTERNAL_CALENDAR_ID}`);
const MOVED_START = new Date("2026-03-15T14:00:00.000Z");
const MOVED_END = new Date("2026-03-15T15:00:00.000Z");
const PREVIOUS_START = new Date("2026-03-15T09:00:00.000Z");
const PREVIOUS_END = new Date("2026-03-15T10:00:00.000Z");

const movedEvent: MaterializedSyncableEvent = {
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: MOVED_END,
  id: LIVE_EVENT_STATE_ID,
  sourceEventUid: "uid-ev-1",
  startTime: MOVED_START,
  summary: "Shared calendar standup",
};

const makeMapping = (): EventMapping => ({
  calendarId: "dest-cal-1",
  deleteIdentifier: GOOGLE_EVENT_ID,
  destinationEventUid: REMOTE_ICAL_UID,
  endTime: PREVIOUS_END,
  eventStateId: LIVE_EVENT_STATE_ID,
  id: MAPPING_ID,
  sourceCalendarId: "cal-1",
  startTime: PREVIOUS_START,
  syncEventHash: "diverged-remote-hash",
  syncEventId: LIVE_EVENT_STATE_ID,
});

const makeRemoteEvent = (startTime: Date, endTime: Date): RemoteEvent => ({
  deleteId: GOOGLE_EVENT_ID,
  endTime,
  isKeeperEvent: true,
  startTime,
  uid: REMOTE_ICAL_UID,
});

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "dest-cal-1",
  externalCalendarId: EXTERNAL_CALENDAR_ID,
  refreshToken: "test-refresh",
  userId: "user-1",
});

describe("an updated event leaves the mapping pointing at it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchMocks.executeBatchChunked.mockResolvedValue([{
      body: {
        end: { dateTime: MOVED_END.toISOString() },
        iCalUID: REMOTE_ICAL_UID,
        id: GOOGLE_EVENT_ID,
        start: { dateTime: MOVED_START.toISOString() },
        summary: movedEvent.summary,
      },
      headers: {},
      statusCode: 200,
    }]);
  });

  it("records the identity google actually kept so the next pass over the unchanged calendar emits nothing", async () => {
    expect(REMOTE_ICAL_UID).not.toBe(
      generateDeterministicEventUid(`${LIVE_EVENT_STATE_ID}:${EXTERNAL_CALENDAR_ID}`),
    );

    const mapping = makeMapping();
    const firstPass = computeSyncOperations(
      [movedEvent],
      [mapping],
      [makeRemoteEvent(PREVIOUS_START, PREVIOUS_END)],
      TEST_RECONCILIATION_SCOPE,
    );
    const replacements = firstPass.operations.filter(
      (operation): operation is Extract<SyncOperation, { type: "replace" }> => operation.type === "replace",
    );
    expect(replacements).toHaveLength(1);

    const run = await executeRemoteOperations(
      firstPass.operations,
      [mapping],
      "dest-cal-1",
      createProvider(),
    );
    expect(run.changes.deletes).toEqual([]);
    expect(run.changes.inserts).toEqual([]);

    const [pendingUpdate] = run.changes.updates ?? [];
    if (!pendingUpdate) {
      throw new Error("expected the in-place update to rewrite the existing mapping row");
    }

    const updatedMapping: EventMapping = {
      ...mapping,
      deleteIdentifier: pendingUpdate.deleteIdentifier,
      destinationEventUid: pendingUpdate.destinationEventUid ?? mapping.destinationEventUid,
      endTime: pendingUpdate.endTime,
      startTime: pendingUpdate.startTime,
      syncEventHash: pendingUpdate.syncEventHash,
      syncEventId: pendingUpdate.syncEventId,
    };
    expect(updatedMapping.destinationEventUid).toBe(REMOTE_ICAL_UID);

    const secondPass = computeSyncOperations(
      [movedEvent],
      [updatedMapping],
      [makeRemoteEvent(MOVED_START, MOVED_END)],
      TEST_RECONCILIATION_SCOPE,
    );

    expect(secondPass.operations).toEqual([]);
    expect(secondPass.staleMappingIds).toEqual([]);
  });
});
