import { describe, expect, it } from "vitest";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../src/core/events/content-hash";
import type { EventMapping } from "../../src/core/events/mappings";
import { createDatabaseFlush } from "../../src/core/sync-engine/flush";
import { syncCalendar } from "../../src/core/sync-engine/index";
import type { PendingChanges } from "../../src/core/sync-engine/types";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const MAPPING_COUNT = 60;
const WRITE_STATEMENT_BUDGET = 5;
const START_HOUR = 9;

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

const buildLocalEvent = (index: number): MaterializedSyncableEvent => {
  const startTime = new Date(Date.UTC(2026, 4, 14, START_HOUR, index));
  const endTime = new Date(Date.UTC(2026, 4, 14, START_HOUR + 1, index));
  return {
    calendarId: SOURCE_CALENDAR_ID,
    calendarName: "Source calendar",
    calendarUrl: null,
    description: `Agenda for meeting ${index}`,
    endTime,
    id: `sync-event-${index}`,
    location: "Meeting room",
    sourceEventUid: `source-uid-${index}`,
    startTime,
    summary: `Weekly planning ${index}`,
  };
};

const buildRemoteEvent = (event: MaterializedSyncableEvent, index: number): RemoteEvent => {
  const content = createEditableEventContentSnapshot({
    description: event.description ?? "",
    location: event.location ?? "",
    summary: event.summary,
  });
  return {
    deleteId: `remote-uid-${index}`,
    editableAvailability: "busy",
    editableContent: content,
    editableContentHash: hashEditableEventContentSnapshot(content),
    endTime: event.endTime,
    isKeeperEvent: true,
    startTime: event.startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: `remote-uid-${index}`,
  };
};

const buildMapping = (event: MaterializedSyncableEvent, index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `remote-uid-${index}`,
  destinationEventUid: `remote-uid-${index}`,
  endTime: event.endTime,
  eventStateId: event.id,
  id: `legacy-mapping-${index}`,
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const createStatementChain = (): unknown =>
  new Proxy(() => null, {
    apply: () => createStatementChain(),
    get: (_target, property) => {
      if (property === "then") {
        return (resolve: (value: unknown) => void) => {
          resolve(null);
        };
      }
      return createStatementChain();
    },
  });

const createRecordingDatabase = (statements: string[]) => ({
  transaction: (callback: (transaction: unknown) => Promise<void>) => {
    const transactionClient = new Proxy({}, {
      get: (_target, property) => {
        if (property === "then") {
          return null;
        }
        return () => {
          statements.push(String(property));
          return createStatementChain();
        };
      },
    });
    return callback(transactionClient);
  },
});

describe("the first reconcile after deploy", () => {
  it("records the provider form for existing mappings without a write statement per mapping", async () => {
    const localEvents = Array.from({ length: MAPPING_COUNT }, (_unused, index) => buildLocalEvent(index));
    const remoteEvents = localEvents.map((event, index) => buildRemoteEvent(event, index));
    const existingMappings = localEvents.map((event, index) => buildMapping(event, index));

    const statements: string[] = [];
    const recordingDatabase = createRecordingDatabase(statements);
    const databaseFlush = createDatabaseFlush(recordingDatabase as never);
    const flushedUpdateCounts: number[] = [];

    const flush = async (changes: PendingChanges): Promise<void> => {
      flushedUpdateCounts.push(changes.updates?.length ?? 0);
      await databaseFlush(changes);
    };

    const pushedEventIds: string[] = [];
    const deletedIds: string[] = [];
    const provider = {
      deleteEvents: (deleteIds: string[]): Promise<DeleteResult[]> => {
        deletedIds.push(...deleteIds);
        return Promise.resolve(deleteIds.map(() => ({ success: true })));
      },
      listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve(remoteEvents),
      pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
        pushedEventIds.push(...events.map((event) => event.id));
        return Promise.resolve(events.map((event, index): PushResult => ({
          deleteId: `pushed-${index}`,
          remoteId: `pushed-${index}`,
          success: true,
        })));
      },
    };

    await expect(syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush,
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: () => Promise.resolve({ existingMappings, localEvents, remoteEvents }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).resolves.toMatchObject({ added: 0, removed: 0 });

    expect(pushedEventIds).toEqual([]);
    expect(deletedIds).toEqual([]);
    expect(flushedUpdateCounts).toEqual([MAPPING_COUNT]);
    expect(statements.length).toBeLessThanOrEqual(WRITE_STATEMENT_BUDGET);
  });
});
