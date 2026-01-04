import type {
  SyncableEvent,
  PushResult,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  ProviderConfig,
  SyncOperation,
  ListRemoteEventsOptions,
} from "./types";
import {
  getEventMappingsForDestination,
  createEventMapping,
  deleteEventMapping,
  deleteEventMappingByDestinationUid,
  countMappingsForDestination,
  type EventMapping,
} from "./mappings";
import { generateEventUid, isKeeperEvent } from "./event-identity";
import type { SyncContext, SyncStage } from "./sync-coordinator";

export abstract class CalendarProvider<
  TConfig extends ProviderConfig = ProviderConfig,
> {
  abstract readonly name: string;
  abstract readonly id: string;

  constructor(protected config: TConfig) {}

  abstract pushEvents(events: SyncableEvent[]): Promise<PushResult[]>;
  abstract deleteEvents(eventIds: string[]): Promise<DeleteResult[]>;
  abstract listRemoteEvents(
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]>;

  async sync(
    localEvents: SyncableEvent[],
    context: SyncContext,
  ): Promise<SyncResult> {
    const { database, userId, destinationId } = this.config;

    this.emitProgress(context, {
      stage: "fetching",
      localEventCount: localEvents.length,
      remoteEventCount: 0,
    });

    const [existingMappings, remoteEvents] = await Promise.all([
      getEventMappingsForDestination(database, destinationId),
      this.listRemoteEvents({ until: this.getTenYearsFromNow() }),
    ]);

    this.emitProgress(context, {
      stage: "comparing",
      localEventCount: localEvents.length,
      remoteEventCount: remoteEvents.length,
    });

    const { operations, staleMappingIds } = this.computeSyncOperations(
      localEvents,
      existingMappings,
      remoteEvents,
    );

    if (staleMappingIds.length > 0) {
      await Promise.all(
        staleMappingIds.map((id) => deleteEventMapping(database, id)),
      );
    }

    const addCount = operations.filter((op) => op.type === "add").length;
    const removeCount = operations.filter((op) => op.type === "remove").length;

    if (operations.length === 0) {
      const mappingCount = await countMappingsForDestination(database, destinationId);
      await context.onDestinationSync?.({
        userId,
        destinationId,
        localEventCount: localEvents.length,
        remoteEventCount: mappingCount,
      });
      return { added: 0, removed: 0 };
    }

    const processed = await this.processOperations(operations, {
      context,
      localEventCount: localEvents.length,
      remoteEventCount: remoteEvents.length,
    });

    const finalRemoteCount = await countMappingsForDestination(database, destinationId);
    await context.onDestinationSync?.({
      userId,
      destinationId,
      localEventCount: localEvents.length,
      remoteEventCount: finalRemoteCount,
      broadcast: true,
    });

    return processed;
  }

  private computeSyncOperations(
    localEvents: SyncableEvent[],
    existingMappings: EventMapping[],
    remoteEvents: RemoteEvent[],
  ): { operations: SyncOperation[]; staleMappingIds: string[] } {
    const localEventIds = new Set(localEvents.map((event) => event.id));
    const remoteEventUids = new Set(remoteEvents.map((event) => event.uid));
    const mappedDestinationUids = new Set(
      existingMappings.map(({ destinationEventUid }) => destinationEventUid),
    );

    const operations: SyncOperation[] = [];
    const staleMappingIds: string[] = [];
    const staleMappedEventIds = new Set<string>();

    for (const mapping of existingMappings) {
      const localEventExists = localEventIds.has(mapping.eventStateId);
      const remoteEventExists = remoteEventUids.has(mapping.destinationEventUid);

      if (localEventExists && !remoteEventExists) {
        staleMappingIds.push(mapping.id);
        staleMappedEventIds.add(mapping.eventStateId);
      }
    }

    for (const event of localEvents) {
      const hasMapping = existingMappings.some(
        (mapping) => mapping.eventStateId === event.id,
      );
      const hasStaleMapping = staleMappedEventIds.has(event.id);

      if (!hasMapping || hasStaleMapping) {
        operations.push({ type: "add", event });
      }
    }

    for (const mapping of existingMappings) {
      if (!localEventIds.has(mapping.eventStateId)) {
        operations.push({
          type: "remove",
          uid: mapping.destinationEventUid,
          deleteId: mapping.deleteIdentifier,
          startTime: mapping.startTime,
        });
      }
    }

    for (const remoteEvent of remoteEvents) {
      if (!mappedDestinationUids.has(remoteEvent.uid)) {
        operations.push({
          type: "remove",
          uid: remoteEvent.uid,
          deleteId: remoteEvent.deleteId,
          startTime: remoteEvent.startTime,
        });
      }
    }

    return {
      operations: this.sortOperationsByTime(operations),
      staleMappingIds,
    };
  }

  private sortOperationsByTime(operations: SyncOperation[]): SyncOperation[] {
    return operations.sort((first, second) => {
      const firstTime = this.getOperationEventTime(first).getTime();
      const secondTime = this.getOperationEventTime(second).getTime();
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
    const { database, destinationId } = this.config;
    const total = operations.length;
    let current = 0;
    let added = 0;
    let removed = 0;
    let currentRemoteCount = params.remoteEventCount;

    for (const operation of operations) {
      if (!(await params.context.isCurrent())) {
        break;
      }

      const eventTime = this.getOperationEventTime(operation);

      if (operation.type === "add") {
        const [result] = await this.pushEvents([operation.event]);
        if (result?.shouldContinue === false) {
          break;
        }
        if (result?.success && result.remoteId) {
          await createEventMapping(database, {
            eventStateId: operation.event.id,
            destinationId,
            destinationEventUid: result.remoteId,
            deleteIdentifier: result.deleteId,
            startTime: operation.event.startTime,
            endTime: operation.event.endTime,
          });
          added++;
          currentRemoteCount++;
        }
      } else {
        const [result] = await this.deleteEvents([operation.deleteId]);
        if (result?.shouldContinue === false) {
          break;
        }
        if (result?.success) {
          await deleteEventMappingByDestinationUid(
            database,
            destinationId,
            operation.uid,
          );
          removed++;
          if (currentRemoteCount > 0) currentRemoteCount--;
        }
      }

      current++;

      this.emitProgress(params.context, {
        stage: "processing",
        localEventCount: params.localEventCount,
        remoteEventCount: currentRemoteCount,
        progress: { current, total },
        lastOperation: {
          type: operation.type,
          eventTime: eventTime.toISOString(),
        },
      });

      await params.context.onDestinationSync?.({
        userId: this.config.userId,
        destinationId: this.config.destinationId,
        localEventCount: params.localEventCount,
        remoteEventCount: currentRemoteCount,
        broadcast: false,
      });
    }

    return { added, removed };
  }

  private getOperationEventTime(operation: SyncOperation): Date {
    if (operation.type === "add") {
      return operation.event.startTime;
    }
    return operation.startTime;
  }

  private getTenYearsFromNow(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 10);
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
      userId: this.config.userId,
      destinationId: this.config.destinationId,
      status: "syncing",
      stage: params.stage,
      localEventCount: params.localEventCount,
      remoteEventCount: params.remoteEventCount,
      progress: params.progress,
      lastOperation: params.lastOperation,
      inSync: false,
    });
  }

  protected generateUid(): string {
    return generateEventUid();
  }

  protected isKeeperEvent(uid: string): boolean {
    return isKeeperEvent(uid);
  }
}
