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
import { computeSyncOperations } from "./operations";
import { widelog } from "widelogger";

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
  protected config: TConfig;

  constructor(config: TConfig) {
    this.config = config;
  }

  abstract pushEvents(events: SyncableEvent[]): Promise<PushResult[]>;
  abstract deleteEvents(eventIds: string[]): Promise<DeleteResult[]>;
  abstract listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]>;

  async sync(localEvents: SyncableEvent[], context: SyncContext): Promise<SyncResult> {
    const { database, userId, calendarId } = this.config;

    widelog.set("operation.name", "sync:provider");
    widelog.set("operation.type", "sync");
    widelog.set("destination.calendar_id", calendarId);
    widelog.set("destination.provider", this.id);
    widelog.set("user.id", userId);
    widelog.set("local_events.count", localEvents.length);
    if (context.jobName) {
      widelog.set("job.name", context.jobName);
    }
    if (context.jobType) {
      widelog.set("job.type", context.jobType);
    }

    try {
      return await widelog.time.measure("sync.provider.duration_ms", async () => {
        this.emitProgress(context, {
          localEventCount: localEvents.length,
          remoteEventCount: INITIAL_REMOTE_EVENT_COUNT,
          stage: "fetching",
        });

        const [existingMappings, remoteEvents] = await Promise.all([
          getEventMappingsForDestination(database, calendarId),
          this.listRemoteEvents({ until: CalendarProvider.getFutureDate() }),
        ]);

        widelog.set("remote_events.count", remoteEvents.length);
        widelog.set("existing_mappings.count", existingMappings.length);

        this.emitProgress(context, {
          localEventCount: localEvents.length,
          remoteEventCount: remoteEvents.length,
          stage: "comparing",
        });

        if (!(await context.isCurrent())) {
          widelog.set("outcome", "superseded");
          return CalendarProvider.emptySyncResult();
        }

        const { operations, staleMappingIds } = computeSyncOperations(
          localEvents,
          existingMappings,
          remoteEvents,
        );

        const addCount = operations.filter((operation) => operation.type === "add").length;
        const removeCount = operations.filter((operation) => operation.type === "remove").length;

        widelog.set("operations.add_count", addCount);
        widelog.set("operations.remove_count", removeCount);
        widelog.set("operations.total", operations.length);
        widelog.set("stale_mappings.count", staleMappingIds.length);

        if (staleMappingIds.length > EMPTY_STALE_MAPPINGS_COUNT) {
          const staleMappings = existingMappings.filter((mapping: EventMapping) =>
            staleMappingIds.includes(mapping.id),
          );
          await Promise.all(
            staleMappings.map((mapping: EventMapping) => deleteEventMapping(database, mapping.id)),
          );
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

          widelog.set("outcome", "in-sync");
          return CalendarProvider.emptySyncResult();
        }

        const processed = await this.processOperations(operations, {
          context,
          localEventCount: localEvents.length,
          remoteEventCount: remoteEvents.length,
        });

        widelog.set("events.added", processed.added);
        widelog.set("events.add_failed", processed.addFailed);
        widelog.set("events.removed", processed.removed);
        widelog.set("events.remove_failed", processed.removeFailed);

        if (!(await context.isCurrent())) {
          widelog.set("outcome", "superseded");
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

        widelog.set("outcome", "success");
        widelog.set("final_remote_count", finalRemoteCount);
        return processed;
      });
    } catch (error) {
      widelog.set("outcome", "error");
      widelog.errorFields(error);

      const shouldEmitError = await context.isCurrent().catch(() => false);

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

  private processPushOperation(
    operation: Extract<SyncOperation, { type: "add" }>,
    progress: { current: number; total: number },
  ): Promise<PushResult | undefined> {
    const { database, calendarId } = this.config;

    widelog.set("operation.name", "sync:push-event");
    widelog.set("operation.type", "sync");
    widelog.set("destination.calendar_id", calendarId);
    widelog.set("destination.provider", this.id);
    widelog.set("user.id", this.config.userId);
    widelog.set("event.start_time", operation.event.startTime.toISOString());
    widelog.set("event.end_time", operation.event.endTime.toISOString());
    widelog.set("event.summary", operation.event.summary);
    widelog.set("event.source_uid", operation.event.sourceEventUid);
    widelog.set("event.state_id", operation.event.id);
    widelog.set("progress.current", progress.current);
    widelog.set("progress.total", progress.total);

    return widelog.time.measure("sync.push_event.duration_ms", async () => {
      const [result] = await this.pushEvents([operation.event]);

      widelog.set("push.success", result?.success ?? false);

      if (result?.remoteId) {
        widelog.set("push.remote_id", result.remoteId);
      }

      if (result?.error) {
        widelog.set("push.error", result.error);
      }

      if (result?.shouldContinue !== globalThis.undefined) {
        widelog.set("push.should_continue", result.shouldContinue);
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
        widelog.set("mapping.created", true);
      }

      return result;
    });
  }

  private processDeleteOperation(
    operation: Extract<SyncOperation, { type: "remove" }>,
    progress: { current: number; total: number },
  ): Promise<DeleteResult | undefined> {
    const { database, calendarId } = this.config;

    widelog.set("operation.name", "sync:delete-event");
    widelog.set("operation.type", "sync");
    widelog.set("destination.calendar_id", calendarId);
    widelog.set("destination.provider", this.id);
    widelog.set("user.id", this.config.userId);
    widelog.set("event.uid", operation.uid);
    widelog.set("event.start_time", operation.startTime.toISOString());
    widelog.set("event.delete_id", operation.deleteId);
    widelog.set("progress.current", progress.current);
    widelog.set("progress.total", progress.total);

    return widelog.time.measure("sync.delete_event.duration_ms", async () => {
      const [result] = await this.deleteEvents([operation.deleteId]);

      widelog.set("delete.success", result?.success ?? false);
      if (result?.error) {
        widelog.set("delete.error", result.error);
      }
      if (result?.shouldContinue !== globalThis.undefined) {
        widelog.set("delete.should_continue", result.shouldContinue);
      }

      if (result?.success) {
        await deleteEventMappingByDestinationUid(database, calendarId, operation.uid);
        widelog.set("mapping.deleted", true);
      }

      return result;
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
      const progress = { current: current + 1, total };

      if (operation.type === "add") {
        const pushResult = await this.processPushOperation(operation, progress);

        if (pushResult?.shouldContinue === false) {
          break;
        }
        if (pushResult?.success && pushResult.remoteId) {
          added++;
          currentRemoteCount++;
        } else {
          addFailed++;
        }
      } else {
        const deleteResult = await this.processDeleteOperation(operation, progress);

        if (deleteResult?.shouldContinue === false) {
          break;
        }
        if (deleteResult?.success) {
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
