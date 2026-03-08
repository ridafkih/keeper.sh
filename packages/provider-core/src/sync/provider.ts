import type {
  DeleteResult,
  ListRemoteEventsOptions,
  ProviderConfig,
  PushResult,
  RemoteEvent,
  SyncOperation,
  SyncResult,
  SyncableEvent,
} from "../types";
import {
  countMappingsForDestination,
  createEventMapping,
  deleteEventMapping,
  deleteEventMappingByDestinationUid,
  getEventMappingsForDestination,
} from "../events/mappings";
import type { EventMapping } from "../events/mappings";
import { createSyncEventContentHash } from "../events/content-hash";
import type { SyncContext, SyncStage } from "./coordinator";
import { WideEvent } from "@keeper.sh/log";
import { getStartOfToday } from "@keeper.sh/date-utils";

const INITIAL_REMOTE_EVENT_COUNT = 0;
const EMPTY_STALE_MAPPINGS_COUNT = 0;
const EMPTY_OPERATIONS_COUNT = 0;
const INITIAL_CURRENT_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;
const YEARS_UNTIL_FUTURE = 2;
const MIN_REMOTE_COUNT = 0;

abstract class CalendarProvider<TConfig extends ProviderConfig = ProviderConfig> {
  abstract readonly name: string;
  abstract readonly id: string;

  constructor(protected config: TConfig) {}

  abstract pushEvents(events: SyncableEvent[]): Promise<PushResult[]>;
  abstract deleteEvents(eventIds: string[]): Promise<DeleteResult[]>;
  abstract listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]>;

  async sync(localEvents: SyncableEvent[], context: SyncContext): Promise<SyncResult> {
    const { database, userId, calendarId } = this.config;

    try {
      this.emitProgress(context, {
        localEventCount: localEvents.length,
        remoteEventCount: INITIAL_REMOTE_EVENT_COUNT,
        stage: "fetching",
      });

      const [existingMappings, remoteEvents] = await Promise.all([
        getEventMappingsForDestination(database, calendarId),
        this.listRemoteEvents({ until: CalendarProvider.getFutureDate() }),
      ]);

      this.emitProgress(context, {
        localEventCount: localEvents.length,
        remoteEventCount: remoteEvents.length,
        stage: "comparing",
      });

      if (!(await context.isCurrent())) {
        return CalendarProvider.emptySyncResult();
      }

      const { operations, staleMappingIds } = CalendarProvider.computeSyncOperations(
        localEvents,
        existingMappings,
        remoteEvents,
      );

      if (staleMappingIds.length > EMPTY_STALE_MAPPINGS_COUNT) {
        const staleMappings = existingMappings.filter((mapping) =>
          staleMappingIds.includes(mapping.id),
        );
        await Promise.all(staleMappings.map((mapping) => deleteEventMapping(database, mapping.id)));
      }

      if (operations.length === EMPTY_OPERATIONS_COUNT) {
        if (await context.isCurrent()) {
          const mappingCount = await countMappingsForDestination(database, calendarId);
          await context.onDestinationSync?.({
            calendarId,
            localEventCount: localEvents.length,
            remoteEventCount: mappingCount,
            userId,
          });
        }

        return CalendarProvider.emptySyncResult();
      }

      const processed = await this.processOperations(operations, {
        context,
        localEventCount: localEvents.length,
        remoteEventCount: remoteEvents.length,
      });

      if (!(await context.isCurrent())) {
        return processed;
      }

      const finalRemoteCount = await countMappingsForDestination(database, calendarId);
      await context.onDestinationSync?.({
        broadcast: true,
        calendarId,
        localEventCount: localEvents.length,
        remoteEventCount: finalRemoteCount,
        userId,
      });

      return processed;
    } catch (error) {
      WideEvent.error(error);

      let shouldEmitError = false;
      try {
        shouldEmitError = await context.isCurrent();
      } catch {
        shouldEmitError = false;
      }

      if (shouldEmitError) {
        context.onSyncProgress?.({
          calendarId: this.config.calendarId,
          error: String(error),
          inSync: false,
          localEventCount: localEvents.length,
          remoteEventCount: INITIAL_REMOTE_EVENT_COUNT,
          stage: "error",
          status: "error",
          userId: this.config.userId,
        });
      }

      throw error;
    }
  }

  private static emptySyncResult(): SyncResult {
    return {
      addFailed: INITIAL_ADD_FAILED_COUNT,
      added: INITIAL_ADDED_COUNT,
      removeFailed: INITIAL_REMOVE_FAILED_COUNT,
      removed: INITIAL_REMOVED_COUNT,
    };
  }

  private static computeSyncOperations(
    localEvents: SyncableEvent[],
    existingMappings: EventMapping[],
    remoteEvents: RemoteEvent[],
  ): { operations: SyncOperation[]; staleMappingIds: string[] } {
    const localEventIds = new Set(localEvents.map((event) => event.id));
    const localEventHashes = new Map(
      localEvents.map((event) => [event.id, createSyncEventContentHash(event)]),
    );
    const remoteEventUids = new Set(remoteEvents.map((event) => event.uid));
    const mappedDestinationUids = new Set(
      existingMappings.map(({ destinationEventUid }) => destinationEventUid),
    );

    const { staleMappingIds, staleMappedEventIds, staleRemoteMappings } =
      CalendarProvider.identifyStaleMappings(
        existingMappings,
        localEventIds,
        remoteEventUids,
        localEventHashes,
      );

    const addOperations = CalendarProvider.buildAddOperations(
      localEvents,
      existingMappings,
      staleMappedEventIds,
    );

    const removeOperations = CalendarProvider.buildRemoveOperations(
      existingMappings,
      remoteEvents,
      localEventIds,
      mappedDestinationUids,
    );

    const staleMappingRemoveOperations =
      CalendarProvider.buildRemoveOperationsForMappings(staleRemoteMappings);

    return {
      operations: CalendarProvider.sortOperationsByTime([
        ...addOperations,
        ...removeOperations,
        ...staleMappingRemoveOperations,
      ]),
      staleMappingIds,
    };
  }

  private static identifyStaleMappings(
    mappings: EventMapping[],
    localEventIds: Set<string>,
    remoteEventUids: Set<string>,
    localEventHashes: Map<string, string>,
  ): {
    staleMappingIds: string[];
    staleMappedEventIds: Set<string>;
    staleRemoteMappings: EventMapping[];
  } {
    const staleMappingIds: string[] = [];
    const staleMappedEventIds = new Set<string>();
    const staleRemoteMappings: EventMapping[] = [];

    for (const mapping of mappings) {
      const localEventExists = localEventIds.has(mapping.eventStateId);
      const remoteEventExists = remoteEventUids.has(mapping.destinationEventUid);

      if (localEventExists && !remoteEventExists) {
        staleMappingIds.push(mapping.id);
        staleMappedEventIds.add(mapping.eventStateId);
        continue;
      }

      if (!localEventExists || !remoteEventExists) {
        continue;
      }

      const localEventHash = localEventHashes.get(mapping.eventStateId);
      if (!localEventHash) {
        continue;
      }

      if (mapping.syncEventHash !== localEventHash) {
        staleMappingIds.push(mapping.id);
        staleRemoteMappings.push(mapping);
      }
    }

    return { staleMappedEventIds, staleMappingIds, staleRemoteMappings };
  }

  private static buildAddOperations(
    localEvents: SyncableEvent[],
    existingMappings: EventMapping[],
    staleMappedEventIds: Set<string>,
  ): SyncOperation[] {
    const operations: SyncOperation[] = [];

    for (const event of localEvents) {
      const hasMapping = existingMappings.some((mapping) => mapping.eventStateId === event.id);
      const hasStaleMapping = staleMappedEventIds.has(event.id);

      if (!hasMapping || hasStaleMapping) {
        operations.push({ event, type: "add" });
      }
    }

    return operations;
  }

  private static buildRemoveOperations(
    existingMappings: EventMapping[],
    remoteEvents: RemoteEvent[],
    localEventIds: Set<string>,
    mappedDestinationUids: Set<string>,
  ): SyncOperation[] {
    const operations: SyncOperation[] = [];
    const now = new Date();
    const startOfToday = getStartOfToday();

    for (const mapping of existingMappings) {
      if (mapping.startTime < startOfToday) {
        continue;
      }

      if (!localEventIds.has(mapping.eventStateId)) {
        operations.push({
          deleteId: mapping.deleteIdentifier,
          startTime: mapping.startTime,
          type: "remove",
          uid: mapping.destinationEventUid,
        });
      }
    }

    for (const remoteEvent of remoteEvents) {
      if (mappedDestinationUids.has(remoteEvent.uid)) {
        continue;
      }

      const isOrphanedKeeperEvent = remoteEvent.isKeeperEvent;
      const isPastEvent = remoteEvent.startTime <= now;

      if (!isOrphanedKeeperEvent && !isPastEvent) {
        continue;
      }

      operations.push({
        deleteId: remoteEvent.deleteId,
        startTime: remoteEvent.startTime,
        type: "remove",
        uid: remoteEvent.uid,
      });
    }

    return operations;
  }

  private static buildRemoveOperationsForMappings(mappings: EventMapping[]): SyncOperation[] {
    return mappings.map((mapping) => ({
      deleteId: mapping.deleteIdentifier,
      startTime: mapping.startTime,
      type: "remove",
      uid: mapping.destinationEventUid,
    }));
  }

  private static sortOperationsByTime(operations: SyncOperation[]): SyncOperation[] {
    return operations.toSorted((first, second) => {
      const firstTime = CalendarProvider.getOperationEventTime(first).getTime();
      const secondTime = CalendarProvider.getOperationEventTime(second).getTime();
      return firstTime - secondTime;
    });
  }

  private async processOperations(
    operations: SyncOperation[],
    params: {
      context: SyncContext;
      localEventCount: number;
      remoteEventCount: number;
    },
  ): Promise<SyncResult> {
    const { database, calendarId } = this.config;
    const total = operations.length;
    let current = INITIAL_CURRENT_COUNT;
    let added = INITIAL_ADDED_COUNT;
    let addFailed = INITIAL_ADD_FAILED_COUNT;
    let removed = INITIAL_REMOVED_COUNT;
    let removeFailed = INITIAL_REMOVE_FAILED_COUNT;
    let currentRemoteCount = params.remoteEventCount;

    for (const operation of operations) {
      if (!(await params.context.isCurrent())) {
        break;
      }

      const eventTime = CalendarProvider.getOperationEventTime(operation);

      if (operation.type === "add") {
        const [result] = await this.pushEvents([operation.event]);
        if (result?.shouldContinue === false) {
          break;
        }
        if (result?.success && result.remoteId) {
          await createEventMapping(database, {
            calendarId,
            deleteIdentifier: result.deleteId,
            destinationEventUid: result.remoteId,
            endTime: operation.event.endTime,
            eventStateId: operation.event.id,
            syncEventHash: createSyncEventContentHash(operation.event),
            startTime: operation.event.startTime,
          });
          added++;
          currentRemoteCount++;
        } else {
          WideEvent.grasp()?.set({
            "push.error": result?.error,
            "push.remote_id": result?.remoteId,
            "push.success": result?.success,
          });
          addFailed++;
        }
      } else {
        const [result] = await this.deleteEvents([operation.deleteId]);
        if (result?.shouldContinue === false) {
          break;
        }
        if (result?.success) {
          await deleteEventMappingByDestinationUid(database, calendarId, operation.uid);
          removed++;
          if (currentRemoteCount > MIN_REMOTE_COUNT) {
            currentRemoteCount--;
          }
        } else {
          removeFailed++;
        }
      }

      current++;

      this.emitProgress(params.context, {
        lastOperation: {
          eventTime: eventTime.toISOString(),
          type: operation.type,
        },
        localEventCount: params.localEventCount,
        progress: { current, total },
        remoteEventCount: currentRemoteCount,
        stage: "processing",
      });
    }

    return { addFailed, added, removeFailed, removed };
  }

  private static getOperationEventTime(operation: SyncOperation): Date {
    if (operation.type === "add") {
      return operation.event.startTime;
    }
    return operation.startTime;
  }

  private static getFutureDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() + YEARS_UNTIL_FUTURE);
    return date;
  }

  private emitProgress(
    context: SyncContext,
    params: {
      stage: SyncStage;
      localEventCount: number;
      remoteEventCount: number;
      progress?: { current: number; total: number };
      lastOperation?: { type: "add" | "remove"; eventTime: string };
    },
  ): void {
    context.onSyncProgress?.({
      calendarId: this.config.calendarId,
      inSync: false,
      lastOperation: params.lastOperation,
      localEventCount: params.localEventCount,
      progress: params.progress,
      remoteEventCount: params.remoteEventCount,
      stage: params.stage,
      status: "syncing",
      userId: this.config.userId,
    });
  }
}

export { CalendarProvider };
