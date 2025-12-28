import type {
  SyncableEvent,
  PushResult,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  ProviderConfig,
  SyncOperation,
  SlotOperations,
  ListRemoteEventsOptions,
} from "./types";
import { generateEventUid, isKeeperEvent } from "./event-identity";
import type { SyncContext, SyncStage } from "./sync-coordinator";
import { log } from "@keeper.sh/log";

export abstract class CalendarProvider<
  TConfig extends ProviderConfig = ProviderConfig,
> {
  abstract readonly name: string;
  abstract readonly id: string;

  protected readonly childLog = log.child({ provider: this.constructor.name });

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
    const { userId, destinationId } = this.config;

    this.childLog.debug(
      {
        userId,
        localCount: localEvents.length,
      },
      "starting sync",
    );

    this.emitProgress(context, {
      stage: "fetching",
      localEventCount: localEvents.length,
      remoteEventCount: 0,
    });

    const maxEndTime = localEvents.reduce<Date>(
      (max, event) => (event.endTime > max ? event.endTime : max),
      new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
    );

    const remoteEvents = await this.listRemoteEvents({ until: maxEndTime });

    this.emitProgress(context, {
      stage: "comparing",
      localEventCount: localEvents.length,
      remoteEventCount: remoteEvents.length,
    });

    const operations = this.diffEvents(localEvents, remoteEvents);
    const addCount = operations.filter((op) => op.type === "add").length;
    const removeCount = operations.filter((op) => op.type === "remove").length;

    this.childLog.debug(
      { userId, toAddCount: addCount, toRemoveCount: removeCount },
      "diff complete",
    );

    if (operations.length === 0) {
      this.childLog.debug({ userId }, "destination in sync");
      await context.onDestinationSync?.({
        userId,
        destinationId,
        localEventCount: localEvents.length,
        remoteEventCount: remoteEvents.length,
      });
      return { added: 0, removed: 0 };
    }

    const processed = await this.processOperations(operations, {
      context,
      localEventCount: localEvents.length,
      remoteEventCount: remoteEvents.length,
    });

    const finalRemoteCount = remoteEvents.length + processed.added - processed.removed;
    await context.onDestinationSync?.({
      userId,
      destinationId,
      localEventCount: localEvents.length,
      remoteEventCount: finalRemoteCount,
      broadcast: true,
    });

    this.childLog.info(
      { userId, added: processed.added, removed: processed.removed },
      "sync complete",
    );

    return processed;
  }

  private async processOperations(
    operations: SyncOperation[],
    params: {
      context: SyncContext;
      localEventCount: number;
      remoteEventCount: number;
    },
  ): Promise<SyncResult> {
    const total = operations.length;
    let current = 0;
    let added = 0;
    let removed = 0;
    let currentRemoteCount = params.remoteEventCount;

    for (const operation of operations) {
      const eventTime = this.getOperationEventTime(operation);

      if (operation.type === "add") {
        await this.pushEvents([operation.event]);
        added++;
        currentRemoteCount++;
      } else {
        await this.deleteEvents([operation.uid]);
        removed++;
        currentRemoteCount--;
      }

      current++;

      await params.context.refreshLock();

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

  private diffEvents(
    localEvents: SyncableEvent[],
    remoteEvents: RemoteEvent[],
  ): SyncOperation[] {
    const timeKey = (start: Date, end: Date) =>
      `${start.getTime()}:${end.getTime()}`;

    const localBySlot = new Map<string, SyncableEvent[]>();
    for (const event of localEvents) {
      const key = timeKey(event.startTime, event.endTime);
      const slotEvents = localBySlot.get(key) ?? [];
      slotEvents.push(event);
      localBySlot.set(key, slotEvents);
    }

    const remoteBySlot = new Map<string, RemoteEvent[]>();
    for (const event of remoteEvents) {
      const key = timeKey(event.startTime, event.endTime);
      const slotEvents = remoteBySlot.get(key) ?? [];
      slotEvents.push(event);
      remoteBySlot.set(key, slotEvents);
    }

    const allSlots = new Set([...localBySlot.keys(), ...remoteBySlot.keys()]);
    const slotOperations: SlotOperations[] = [];

    for (const slot of allSlots) {
      const localSlotEvents = localBySlot.get(slot) ?? [];
      const remoteSlotEvents = remoteBySlot.get(slot) ?? [];

      const [localSlotEvent] = localSlotEvents;
      const [remoteSlotEvent] = remoteSlotEvents;

      const operations: SyncOperation[] = [];

      const startTime = localSlotEvent?.startTime ?? remoteSlotEvent?.startTime;
      if (!startTime) continue;

      const diff = localSlotEvents.length - remoteSlotEvents.length;

      if (diff > 0) {
        for (const event of localSlotEvents.slice(0, diff)) {
          operations.push({ type: "add", event });
        }
      } else if (diff < 0) {
        const surplus = -diff;
        for (const event of remoteSlotEvents.slice(0, surplus)) {
          operations.push({
            type: "remove",
            uid: event.uid,
            startTime: event.startTime,
          });
        }
      }

      if (operations.length > 0) {
        slotOperations.push({ startTime: startTime.getTime(), operations });
      }
    }

    slotOperations.sort((first, second) => first.startTime - second.startTime);
    return slotOperations.flatMap((slot) => slot.operations);
  }

  protected generateUid(): string {
    return generateEventUid();
  }

  protected isKeeperEvent(uid: string): boolean {
    return isKeeperEvent(uid);
  }
}
