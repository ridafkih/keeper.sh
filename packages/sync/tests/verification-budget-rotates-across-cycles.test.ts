import { describe, expect, it } from "vitest";
import type {
  EventMapping,
  EventPresence,
  EventVerificationTarget,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "@keeper.sh/calendar";
import {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
} from "../../calendar/src/core/events/content-hash";
import { computeSyncOperations } from "../../calendar/src/core/sync/operations";
import {
  createDestinationReconciliationScope,
  readDestinationRemoteEvents,
} from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-09-01T00:00:00.000Z"),
  timeMin: new Date("2026-08-01T00:00:00.000Z"),
};

const VERIFICATION_BUDGET = 200;
const LIVE_MAPPING_COUNT = 200;
const DELETED_MAPPING_ID = "mapping-zz-deleted";
const DELETED_DELETE_IDENTIFIER = "id-zz-deleted";
const MAX_CYCLES = 6;

const createStart = (index: number): Date =>
  new Date(REQUESTED_WINDOW.timeMin.getTime() + (index % 27 + 1) * 60 * 60 * 1000);

const withHalfHour = (start: Date): Date => new Date(start.getTime() + 30 * 60 * 1000);

const createLocalEvent = (suffix: string, index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: withHalfHour(createStart(index)),
  eventStateId: `event-state-${suffix}`,
  id: `sync-event-${suffix}`,
  sourceEventUid: `source-uid-${suffix}`,
  startTime: createStart(index),
  summary: `Event ${suffix}`,
});

const createMapping = (
  suffix: string,
  deleteIdentifier: string,
  index: number,
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: deleteIdentifier,
  endTime: withHalfHour(createStart(index)),
  eventStateId: `event-state-${suffix}`,
  id: `mapping-${suffix}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createStart(index),
  syncEventHash: createSyncEventContentHash(createLocalEvent(suffix, index)),
  syncEventId: `sync-event-${suffix}`,
});

const createLiveRemoteEvent = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContent: createEditableEventContentSnapshot(localEvent),
  editableContentHash: createEditableEventContentHash(localEvent),
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  summary: localEvent.summary,
  uid: mapping.destinationEventUid,
});

const liveIndexes = Array.from({ length: LIVE_MAPPING_COUNT }, (unused, index) => index);

const liveSuffixes = liveIndexes.map((index) => `live-${String(index).padStart(3, "0")}`);

const liveMappings = liveSuffixes.map((suffix, index) =>
  createMapping(suffix, `id-${suffix}`, index));

const deletedMapping = createMapping("zz-deleted", DELETED_DELETE_IDENTIFIER, 7);

const localEvents = [
  ...liveSuffixes.map((suffix, index) => createLocalEvent(suffix, index)),
  createLocalEvent("zz-deleted", 7),
];

const localEventsById = new Map(localEvents.map((event) => [event.id, event]));

const allMappings = [...liveMappings, deletedMapping];

const liveRemoteEventsByDeleteId = new Map(liveMappings.map((mapping) => [
  mapping.deleteIdentifier,
  createLiveRemoteEvent(mapping, localEventsById.get(mapping.syncEventId) as MaterializedSyncableEvent),
]));

const answerVerification = (target: EventVerificationTarget): EventPresence => {
  const liveEvent = liveRemoteEventsByDeleteId.get(target.deleteId);
  if (!liveEvent) {
    return { identifier: target.deleteId, status: "absent" };
  }
  return { event: liveEvent, identifier: target.deleteId, status: "present" };
};

const createProviderDouble = () => {
  const verifiedIds: string[] = [];
  return {
    listRemoteEvents: (_options: ListRemoteEventsOptions): Promise<RemoteEvent[]> =>
      Promise.resolve([]),
    verifiedIds,
    verifyEventsExist: (targets: EventVerificationTarget[]): Promise<EventPresence[]> => {
      verifiedIds.push(...targets.map((target) => target.deleteId));
      return Promise.resolve(targets.map((target) => answerVerification(target)));
    },
  };
};

interface VerificationReport {
  nextVerificationCursor?: string | null;
  unverifiedMappingIds: ReadonlySet<string>;
}

interface CycleRead {
  authoritativeMappingIds: ReadonlySet<string> | null;
  remoteEvents: RemoteEvent[];
  verification?: VerificationReport;
}

interface CycleContext {
  existingMappings: EventMapping[];
  localEvents: MaterializedSyncableEvent[];
  provider: ReturnType<typeof createProviderDouble>;
  requestedWindow: typeof REQUESTED_WINDOW;
  verificationCursor?: string | null;
}

const readWithCursor = readDestinationRemoteEvents as unknown as (
  context: CycleContext,
) => Promise<CycleRead>;

interface CycleResult {
  askedIds: string[];
  nextVerificationCursor: string | null;
  operations: SyncOperation[];
  unverifiedMappingIds: ReadonlySet<string>;
}

const runCycle = async (
  mappings: EventMapping[],
  verificationCursor: string | null,
): Promise<CycleResult> => {
  const provider = createProviderDouble();
  const read = await readWithCursor({
    existingMappings: mappings,
    localEvents,
    provider,
    requestedWindow: REQUESTED_WINDOW,
    verificationCursor,
  });
  const unverifiedMappingIds = read.verification?.unverifiedMappingIds ?? new Set<string>();
  const scope = createDestinationReconciliationScope({
    authoritativeMappingIds: read.authoritativeMappingIds,
    authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, REQUESTED_WINDOW]]),
    authoritativeWindow: REQUESTED_WINDOW,
    eventReadDiagnostics: { overBudgetSourceEventStateIds: [] } as never,
    requestedWindow: REQUESTED_WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    unverifiedMappingIds,
  });
  const { operations } = computeSyncOperations(localEvents, mappings, read.remoteEvents, scope);
  return {
    askedIds: provider.verifiedIds,
    nextVerificationCursor: read.verification?.nextVerificationCursor ?? null,
    operations,
    unverifiedMappingIds,
  };
};

const findRestoreOperation = (operations: SyncOperation[]): SyncOperation | undefined =>
  operations.find((operation) =>
    operation.type === "replace" && operation.staleMappingId === DELETED_MAPPING_ID);

describe("verification budget must not starve the same mappings every cycle", () => {
  it("carries the branch's unverified reporting, so the fix is measured against it", async () => {
    const firstCycle = await runCycle(allMappings, null);

    expect(firstCycle.askedIds.length).toBe(VERIFICATION_BUDGET);
    expect(firstCycle.unverifiedMappingIds.size).toBeGreaterThan(0);
  });

  it("verifies every persistently unconfirmed mapping within a bounded number of cycles", async () => {
    const askedPerCycle: number[] = [];
    let cursor: string | null = null;
    let restore: SyncOperation | undefined = globalThis.undefined;
    let cyclesRun = 0;

    while (cyclesRun < MAX_CYCLES && !restore) {
      const cycle: CycleResult = await runCycle(allMappings, cursor);
      cyclesRun += 1;
      askedPerCycle.push(cycle.askedIds.length);
      cursor = cycle.nextVerificationCursor;
      restore = findRestoreOperation(cycle.operations);
    }

    expect(askedPerCycle.every((asked) => asked <= VERIFICATION_BUDGET)).toBe(true);
    expect(restore).toBeDefined();
  });

  it("asks about the same mappings whatever order the rows arrive in at one cursor position", async () => {
    const forward = await runCycle(allMappings, null);
    const reversed = await runCycle(allMappings.toReversed(), null);

    expect(reversed.askedIds).toEqual(forward.askedIds);
  });
});
