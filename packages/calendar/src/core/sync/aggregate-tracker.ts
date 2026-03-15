import type { DestinationSyncResult, SyncProgressUpdate } from "./coordinator";

interface CalendarOperationProgress {
  processed: number;
  status: "syncing" | "idle" | "error";
  total: number;
}

interface SyncAggregateSnapshot {
  lastSyncedAt?: string | null;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  syncing: boolean;
}

interface SyncAggregateMessage extends SyncAggregateSnapshot {
  seq: number;
}

interface SyncAggregateTrackerConfig {
  progressThrottleMs?: number;
}

const DEFAULT_PROGRESS_THROTTLE_MS = 350;
const INITIAL_COUNT = 0;
const INITIAL_SEQUENCE = 0;
const PERCENT_MULTIPLIER = 100;

class SyncAggregateTracker {
  private readonly progressThrottleMs: number;
  private readonly progressByUser = new Map<string, Map<string, CalendarOperationProgress>>();
  private readonly lastProgressEmitAtByUser = new Map<string, number>();
  private readonly lastPayloadKeyByUser = new Map<string, string>();
  private readonly sequenceByUser = new Map<string, number>();

  constructor(config?: SyncAggregateTrackerConfig) {
    this.progressThrottleMs = config?.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
  }

  private getUserProgress(userId: string): Map<string, CalendarOperationProgress> {
    let progress = this.progressByUser.get(userId);
    if (progress) {
      return progress;
    }

    progress = new Map();
    this.progressByUser.set(userId, progress);
    return progress;
  }

  private static clampProgress(processed: number, total: number): number {
    if (processed < INITIAL_COUNT) {
      return INITIAL_COUNT;
    }
    if (processed > total) {
      return total;
    }
    return processed;
  }

  private static calculatePercent(processed: number, total: number, syncing: boolean): number {
    if (total === INITIAL_COUNT) {
      if (syncing) {
        return INITIAL_COUNT;
      }
      return PERCENT_MULTIPLIER;
    }
    return (processed / total) * PERCENT_MULTIPLIER;
  }

  private static mergeProgressEntry(
    current: CalendarOperationProgress | undefined,
    update: SyncProgressUpdate,
  ): CalendarOperationProgress {
    const currentProcessed = current?.processed ?? INITIAL_COUNT;
    const currentTotal = current?.total ?? INITIAL_COUNT;

    const nextTotal = update.progress?.total ?? currentTotal;
    const nextProcessedRaw = update.progress?.current ?? currentProcessed;
    const nextProcessed = SyncAggregateTracker.clampProgress(nextProcessedRaw, nextTotal);

    if (update.status === "error") {
      return {
        processed: nextProcessed,
        status: "error",
        total: nextTotal,
      };
    }

    return {
      processed: nextProcessed,
      status: "syncing",
      total: nextTotal,
    };
  }

  private static finalizeEntry(
    current: CalendarOperationProgress | undefined,
  ): CalendarOperationProgress {
    const total = current?.total ?? INITIAL_COUNT;
    let processed = current?.processed ?? INITIAL_COUNT;
    if (total > INITIAL_COUNT) {
      processed = total;
    }

    return {
      processed,
      status: "idle",
      total,
    };
  }

  private computeSnapshot(
    userId: string,
    options?: { fallback?: Omit<SyncAggregateSnapshot, "syncing">; lastSyncedAt?: string | null },
  ): SyncAggregateSnapshot {
    const progress = this.progressByUser.get(userId);

    if (!progress || progress.size === INITIAL_COUNT) {
      const fallback = options?.fallback ?? {
        progressPercent: PERCENT_MULTIPLIER,
        syncEventsProcessed: INITIAL_COUNT,
        syncEventsRemaining: INITIAL_COUNT,
        syncEventsTotal: INITIAL_COUNT,
      };

      return {
        ...fallback,
        syncing: false,
      };
    }

    let syncEventsProcessed = INITIAL_COUNT;
    let syncEventsTotal = INITIAL_COUNT;
    let syncing = false;

    for (const entry of progress.values()) {
      syncEventsProcessed += entry.processed;
      syncEventsTotal += entry.total;
      if (entry.status === "syncing") {
        syncing = true;
      }
    }

    const syncEventsRemaining = Math.max(syncEventsTotal - syncEventsProcessed, INITIAL_COUNT);
    const progressPercent = SyncAggregateTracker.calculatePercent(
      syncEventsProcessed,
      syncEventsTotal,
      syncing,
    );

    return {
      ...(options && "lastSyncedAt" in options && { lastSyncedAt: options.lastSyncedAt }),
      progressPercent,
      syncEventsProcessed,
      syncEventsRemaining,
      syncEventsTotal,
      syncing,
    };
  }

  private static toPayloadKey(payload: SyncAggregateSnapshot): string {
    return JSON.stringify(payload);
  }

  private getCurrentSequence(userId: string): number {
    return this.sequenceByUser.get(userId) ?? INITIAL_SEQUENCE;
  }

  private nextSequence(userId: string): number {
    const next = this.getCurrentSequence(userId) + 1;
    this.sequenceByUser.set(userId, next);
    return next;
  }

  private maybeEmit(
    userId: string,
    payload: SyncAggregateSnapshot,
    options?: { now?: number; throttleProgress?: boolean },
  ): SyncAggregateMessage | null {
    const payloadKey = SyncAggregateTracker.toPayloadKey(payload);
    const previousPayloadKey = this.lastPayloadKeyByUser.get(userId);
    if (payloadKey === previousPayloadKey) {
      return null;
    }

    const now = options?.now ?? Date.now();
    if (options?.throttleProgress) {
      const lastEmitAt = this.lastProgressEmitAtByUser.get(userId) ?? INITIAL_COUNT;
      if (now - lastEmitAt < this.progressThrottleMs) {
        return null;
      }
      this.lastProgressEmitAtByUser.set(userId, now);
    }

    this.lastPayloadKeyByUser.set(userId, payloadKey);

    return {
      ...payload,
      seq: this.nextSequence(userId),
    };
  }

  trackProgress(update: SyncProgressUpdate): SyncAggregateMessage | null {
    const progress = this.getUserProgress(update.userId);
    const current = progress.get(update.calendarId);
    const next = SyncAggregateTracker.mergeProgressEntry(current, update);
    progress.set(update.calendarId, next);

    const payload = this.computeSnapshot(update.userId);

    return this.maybeEmit(update.userId, payload, {
      now: Date.now(),
      throttleProgress: update.status === "syncing",
    });
  }

  trackDestinationSync(
    result: DestinationSyncResult,
    lastSyncedAt: string,
  ): SyncAggregateMessage | null {
    const progress = this.getUserProgress(result.userId);
    const current = progress.get(result.calendarId);
    progress.set(result.calendarId, SyncAggregateTracker.finalizeEntry(current));

    const payload = this.computeSnapshot(result.userId, { lastSyncedAt });
    return this.maybeEmit(result.userId, payload);
  }

  getCurrentAggregate(
    userId: string,
    fallback?: Omit<SyncAggregateSnapshot, "syncing">,
  ): SyncAggregateMessage {
    const payload = this.computeSnapshot(userId, { fallback });

    return {
      ...payload,
      seq: this.getCurrentSequence(userId),
    };
  }
}

export { SyncAggregateTracker };
export type { SyncAggregateMessage, SyncAggregateSnapshot, SyncAggregateTrackerConfig };
