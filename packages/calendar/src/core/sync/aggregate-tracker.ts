import type { DestinationSyncResult, SyncPace, SyncProgressUpdate } from "./types";

interface CalendarOperationProgress {
  pace?: SyncPace;
  processed: number;
  processingStartedAt: number | null;
  status: "syncing" | "idle" | "error";
  total: number;
}

interface SyncAggregateSnapshot {
  lastSyncedAt?: string | null;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  syncSecondsRemaining?: number;
  syncing: boolean;
}

interface SyncAggregateMessage extends SyncAggregateSnapshot {
  seq: number;
  emittedAt?: string;
}

interface SyncAggregateTrackerConfig {
  now?: () => number;
  progressThrottleMs?: number;
}

const DEFAULT_PROGRESS_THROTTLE_MS = 350;
const INITIAL_COUNT = 0;
const INITIAL_SEQUENCE = 0;
const PERCENT_MULTIPLIER = 100;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const remainingOperations = (entry: CalendarOperationProgress): number =>
  Math.max(entry.total - entry.processed, INITIAL_COUNT);

const resolveObservedPace = (
  calendarId: string,
  entry: CalendarOperationProgress,
  now: number,
): SyncPace | null => {
  if (entry.processingStartedAt === null || entry.processed === INITIAL_COUNT) {
    return null;
  }
  const elapsedMinutes = (now - entry.processingStartedAt) / MS_PER_SECOND / SECONDS_PER_MINUTE;
  if (elapsedMinutes <= 0) {
    return null;
  }
  return { lane: `calendar:${calendarId}`, operationsPerMinute: entry.processed / elapsedMinutes };
};

const estimateSecondsRemaining = (
  progress: Map<string, CalendarOperationProgress>,
  now: number,
): number | null => {
  const remainingByLane = new Map<string, { operations: number; operationsPerMinute: number }>();
  for (const [calendarId, entry] of progress) {
    const operations = remainingOperations(entry);
    if (operations === INITIAL_COUNT) {
      continue;
    }
    const pace = entry.pace ?? resolveObservedPace(calendarId, entry, now);
    if (!pace) {
      return null;
    }
    const lane = remainingByLane.get(pace.lane);
    remainingByLane.set(pace.lane, {
      operations: (lane?.operations ?? INITIAL_COUNT) + operations,
      operationsPerMinute: pace.operationsPerMinute,
    });
  }
  if (remainingByLane.size === INITIAL_COUNT) {
    return null;
  }
  const laneSeconds = [...remainingByLane.values()].map(({ operations, operationsPerMinute }) =>
    (operations / operationsPerMinute) * SECONDS_PER_MINUTE);
  return Math.ceil(Math.max(...laneSeconds));
};

class SyncAggregateTracker {
  private readonly progressThrottleMs: number;
  private readonly now: () => number;
  private readonly progressByUser = new Map<string, Map<string, CalendarOperationProgress>>();
  private readonly lastProgressEmitAtByUser = new Map<string, number>();
  private readonly lastPayloadKeyByUser = new Map<string, string>();
  private readonly sequenceByUser = new Map<string, number>();
  private readonly highWaterPercentByUser = new Map<string, number>();
  private readonly syncingHeldByUser = new Set<string>();

  constructor(config?: SyncAggregateTrackerConfig) {
    this.progressThrottleMs = config?.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
    this.now = config?.now ?? Date.now;
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
    now: number,
  ): CalendarOperationProgress {
    let currentProcessed = INITIAL_COUNT;
    let currentTotal = INITIAL_COUNT;
    let processingStartedAt: number | null = null;
    if (current && current.status !== "idle") {
      currentProcessed = current.processed;
      currentTotal = current.total;
      ({ processingStartedAt } = current);
    }

    const nextTotal = update.progress?.total ?? currentTotal;
    const nextProcessedRaw = update.progress?.current ?? currentProcessed;
    const nextProcessed = SyncAggregateTracker.clampProgress(nextProcessedRaw, nextTotal);
    if (processingStartedAt === null && update.progress) {
      processingStartedAt = now;
    }

    let status: CalendarOperationProgress["status"] = "syncing";
    if (update.status === "error") {
      status = "error";
    }

    return {
      processed: nextProcessed,
      status,
      processingStartedAt,
      total: nextTotal,
      ...(update.pace && { pace: update.pace }),
    };
  }

  private static finalizeEntry(
    current: CalendarOperationProgress | undefined,
    completedSuccessfully: boolean,
  ): CalendarOperationProgress {
    const total = current?.total ?? INITIAL_COUNT;
    let processed = current?.processed ?? INITIAL_COUNT;
    if (total > INITIAL_COUNT && completedSuccessfully) {
      processed = total;
    }

    return {
      ...current,
      processed,
      processingStartedAt: current?.processingStartedAt ?? null,
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
      const syncing = this.syncingHeldByUser.has(userId);

      return {
        ...fallback,
        ...(syncing && { progressPercent: INITIAL_COUNT }),
        syncing,
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

    if (!syncing && this.syncingHeldByUser.has(userId)) {
      syncing = true;
    }

    const syncEventsRemaining = Math.max(syncEventsTotal - syncEventsProcessed, INITIAL_COUNT);
    const syncSecondsRemaining = estimateSecondsRemaining(progress, this.now());
    let progressPercent = SyncAggregateTracker.calculatePercent(
      syncEventsProcessed,
      syncEventsTotal,
      syncing,
    );

    if (syncing) {
      const highWater = this.highWaterPercentByUser.get(userId) ?? INITIAL_COUNT;
      if (progressPercent < highWater) {
        progressPercent = highWater;
      }
    }

    return {
      ...(options && "lastSyncedAt" in options && { lastSyncedAt: options.lastSyncedAt }),
      progressPercent,
      syncEventsProcessed,
      syncEventsRemaining,
      syncEventsTotal,
      ...(syncSecondsRemaining !== null && { syncSecondsRemaining }),
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

    const now = options?.now ?? this.now();
    if (options?.throttleProgress) {
      const lastEmitAt = this.lastProgressEmitAtByUser.get(userId) ?? INITIAL_COUNT;
      if (now - lastEmitAt < this.progressThrottleMs) {
        return null;
      }
      this.lastProgressEmitAtByUser.set(userId, now);
    }

    this.lastPayloadKeyByUser.set(userId, payloadKey);

    if (payload.syncing) {
      this.highWaterPercentByUser.set(userId, payload.progressPercent);
    } else {
      this.highWaterPercentByUser.delete(userId);
    }

    return {
      ...payload,
      seq: this.nextSequence(userId),
    };
  }

  trackProgress(update: SyncProgressUpdate): SyncAggregateMessage | null {
    const progress = this.getUserProgress(update.userId);

    const current = progress.get(update.calendarId);
    const next = SyncAggregateTracker.mergeProgressEntry(current, update, this.now());
    progress.set(update.calendarId, next);

    const payload = this.computeSnapshot(update.userId);

    return this.maybeEmit(update.userId, payload, {
      now: this.now(),
      throttleProgress: update.status === "syncing",
    });
  }

  trackDestinationSync(
    result: DestinationSyncResult,
    lastSyncedAt?: string,
  ): SyncAggregateMessage | null {
    const progress = this.getUserProgress(result.userId);
    const current = progress.get(result.calendarId);
    progress.set(
      result.calendarId,
      SyncAggregateTracker.finalizeEntry(current, result.completedSuccessfully !== false),
    );

    const options: { lastSyncedAt?: string } = {};
    if (lastSyncedAt) {
      options.lastSyncedAt = lastSyncedAt;
    }
    const payload = this.computeSnapshot(result.userId, options);
    return this.maybeEmit(result.userId, payload);
  }

  holdSyncing(userId: string): void {
    this.syncingHeldByUser.add(userId);
  }

  resetUser(userId: string): void {
    this.progressByUser.delete(userId);
    this.highWaterPercentByUser.delete(userId);
    this.lastPayloadKeyByUser.delete(userId);
    this.lastProgressEmitAtByUser.delete(userId);
  }

  releaseSyncing(userId: string): void {
    this.syncingHeldByUser.delete(userId);
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
