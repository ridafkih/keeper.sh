import {
  syncCalendar,
  getEventsForCalendarsWithDiagnostics,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createGoogleUserRateLimiter,
  createRedisRateLimiter,
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
  createSyncWindow,
  getMappedSourceCalendarIds,
  withSourceIngestLocks,
  getConfigurableSyncWindow,
  intersectSyncWindows,
} from "@keeper.sh/calendar";
import { OUTLOOK_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type { Plan } from "@keeper.sh/data-schemas";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import type {
  EventMapping,
  DestinationEventReadDiagnostics,
  MaterializedSyncableEvent,
  ReconciliationScope,
  RefreshLockStore,
  RemoteEvent,
  SyncProgressUpdate,
  SyncWindow,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray, isNull } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import {
  getErrorMessage,
  isBackoffEligibleError,
  resolveDestinationAttemptVerdict,
} from "./destination-errors";
import type { DestinationAttemptVerdict } from "./destination-errors";
import { resolveSyncProvider } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import {
  createMappingMutationLockId,
  createSyncLock,
} from "./sync-lock";
import type { SyncLockHandle } from "./sync-lock";

/*
 * Google's quota is shared across ingest and push, so the push lane claims only its
 * reserved share of the one per-user key. Outlook throttles per mailbox instead, so it
 * gets a key of its own at the mailbox ceiling.
 */
const createProviderRateLimiter = (
  redis: Redis,
  userId: string,
  provider: string,
): RedisRateLimiter | undefined => {
  if (provider === "google") {
    return createGoogleUserRateLimiter(redis, userId, "push");
  }
  if (provider !== "outlook") {
    return;
  }
  return createRedisRateLimiter(redis, `ratelimit:${userId}:outlook`, {
    requestsPerMinute: OUTLOOK_REQUESTS_PER_MINUTE,
  });
};

const resetDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set(RESET_CALENDAR_BACKOFF_STATE)
    .where(eq(calendarsTable.id, calendarId));
};

/**
 * The escalation is a compare-and-set against the retry state the run was
 * judged on. Anything that resets the row while the run is in flight — a
 * reconnect, another worker's verdict — must win over a verdict computed
 * against credentials or a counter that no longer exist.
 */
const matchesObservedNextAttempt = (nextAttemptAt: Date | null) => {
  if (nextAttemptAt === null) {
    return isNull(calendarsTable.nextAttemptAt);
  }
  return eq(calendarsTable.nextAttemptAt, nextAttemptAt);
};

const matchesObservedRetryState = (destination: DestinationAttempt) =>
  and(
    eq(calendarsTable.id, destination.calendarId),
    eq(calendarsTable.failureCount, destination.failureCount),
    matchesObservedNextAttempt(destination.nextAttemptAt),
  );

const applyDestinationBackoff = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  const backoffState = buildCalendarBackoffState(destination.failureCount);

  await database
    .update(calendarsTable)
    .set(backoffState)
    .where(matchesObservedRetryState(destination));
};

const extractNumericField = (event: Record<string, unknown> | null | undefined, key: string): number => {
  if (!event) {
    return 0;
  }
  const value = event[key];
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

interface SyncConfig {
  destinationCalendarId: string;
  database: BunSQLDatabase;
  redis: Redis;
  encryptionKey?: string;
  oauthConfig: OAuthConfig;
  plan: Plan;
  refreshLockStore?: RefreshLockStore | null;
  deadlineMs?: number;
  abortSignal?: AbortSignal;
}

interface SyncDestinationsResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
  syncEvents: Record<string, unknown>[];
}

const EMPTY_RESULT: SyncDestinationsResult = {
  added: 0,
  addFailed: 0,
  removed: 0,
  removeFailed: 0,
  errors: [],
  syncEvents: [],
};

interface DestinationLocalState {
  localEvents: MaterializedSyncableEvent[];
  existingMappings: EventMapping[];
}

interface DestinationReconciliationContext {
  eventReadDiagnostics: DestinationEventReadDiagnostics;
  localReadDurationMs: number;
  authoritativeWindow: SyncWindow | null;
  requestedWindow: SyncWindow;
  remoteReadDurationMs: number;
  sourceCalendarIdsAtLocalRead: string[];
  sourceCalendarIdsBeforeRemoteRead: string[];
  verifiedSourceCalendarCount: number;
}

const roundDuration = (durationMs: number): number =>
  Math.round(durationMs * 100) / 100;

interface StoredSourceCoverage {
  ingestFutureRange: string | null;
  ingestHistoricRange: string | null;
  ingestWindowEnd: Date | null;
  ingestWindowRecordedAt: Date | null;
  ingestWindowStart: Date | null;
}

const resolveStoredSourceCoverage = (source: StoredSourceCoverage): SyncWindow | null => {
  if (
    !source.ingestWindowStart
    || !source.ingestWindowEnd
    || !source.ingestWindowRecordedAt
    || !Number.isFinite(source.ingestWindowRecordedAt.getTime())
    || !syncRangeSchema.allows(source.ingestHistoricRange)
    || !syncRangeSchema.allows(source.ingestFutureRange)
  ) {
    return null;
  }
  try {
    return createSyncWindow(source.ingestWindowStart, source.ingestWindowEnd);
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

interface SourceAuthority {
  aggregateWindow: SyncWindow | null;
  sourceWindows: Map<string, SyncWindow>;
}

const createAggregateAuthorityWindow = (
  sourceCalendarIds: string[],
  sourceWindows: ReadonlyMap<string, SyncWindow>,
  requestedWindow: SyncWindow,
): SyncWindow | null => {
  if (sourceCalendarIds.length === 0) {
    return requestedWindow;
  }
  if (sourceWindows.size !== sourceCalendarIds.length) {
    return null;
  }

  let aggregateWindow: SyncWindow | null = requestedWindow;
  for (const sourceCalendarId of sourceCalendarIds) {
    const sourceWindow = sourceWindows.get(sourceCalendarId);
    if (!sourceWindow) {
      return null;
    }
    aggregateWindow = intersectSyncWindows(aggregateWindow, sourceWindow);
    if (!aggregateWindow) {
      return null;
    }
  }
  return aggregateWindow;
};

const resolveSourceAuthority = async (
  database: Pick<BunSQLDatabase, "select">,
  sourceCalendarIds: string[],
  requestedWindow: SyncWindow,
): Promise<SourceAuthority> => {
  if (sourceCalendarIds.length === 0) {
    return { aggregateWindow: requestedWindow, sourceWindows: new Map() };
  }
  const sources = await database
    .select({
      id: calendarsTable.id,
      ingestFutureRange: calendarsTable.ingestFutureRange,
      ingestHistoricRange: calendarsTable.ingestHistoricRange,
      ingestWindowEnd: calendarsTable.ingestWindowEnd,
      ingestWindowRecordedAt: calendarsTable.ingestWindowRecordedAt,
      ingestWindowStart: calendarsTable.ingestWindowStart,
    })
    .from(calendarsTable)
    .where(inArray(calendarsTable.id, sourceCalendarIds));

  const sourceWindows = new Map<string, SyncWindow>();
  for (const source of sources) {
    const sourceCoverage = resolveStoredSourceCoverage(source);
    if (!sourceCoverage) {
      continue;
    }
    const sourceWindow = intersectSyncWindows(requestedWindow, sourceCoverage);
    if (sourceWindow) {
      sourceWindows.set(source.id, sourceWindow);
    }
  }
  return {
    aggregateWindow: createAggregateAuthorityWindow(
      sourceCalendarIds,
      sourceWindows,
      requestedWindow,
    ),
    sourceWindows,
  };
};

const narrowSourceAuthority = (
  initialSourceWindows: ReadonlyMap<string, SyncWindow>,
  currentSourceWindows: ReadonlyMap<string, SyncWindow>,
): Map<string, SyncWindow> => {
  const narrowedSourceWindows = new Map<string, SyncWindow>();
  for (const [sourceCalendarId, initialWindow] of initialSourceWindows) {
    const currentWindow = currentSourceWindows.get(sourceCalendarId);
    if (!currentWindow) {
      continue;
    }
    const narrowedWindow = intersectSyncWindows(initialWindow, currentWindow);
    if (narrowedWindow) {
      narrowedSourceWindows.set(sourceCalendarId, narrowedWindow);
    }
  }
  return narrowedSourceWindows;
};

const getBoundingSourceAuthorityWindow = (
  sourceWindows: ReadonlyMap<string, SyncWindow>,
): SyncWindow | null => {
  let timeMin: Date | null = null;
  let timeMax: Date | null = null;
  for (const sourceWindow of sourceWindows.values()) {
    const { timeMax: sourceTimeMax, timeMin: sourceTimeMin } = sourceWindow;
    if (!timeMin || sourceTimeMin < timeMin) {
      timeMin = sourceTimeMin;
    }
    if (!timeMax || sourceTimeMax > timeMax) {
      timeMax = sourceTimeMax;
    }
  }
  if (!timeMin || !timeMax) {
    return null;
  }
  return createSyncWindow(timeMin, timeMax);
};

const haveSourceCalendarsChanged = (
  beforeRemoteRead: string[],
  atLocalRead: string[],
): boolean => {
  if (beforeRemoteRead.length !== atLocalRead.length) {
    return true;
  }

  const orderedBeforeRemoteRead = beforeRemoteRead.toSorted();
  const orderedAtLocalRead = atLocalRead.toSorted();
  return orderedBeforeRemoteRead.some(
    (calendarId, index) => calendarId !== orderedAtLocalRead[index],
  );
};

/*
 * Every series a calendar withholds for exceeding the occurrence budget lands in this
 * list, so a pathological source can push thousands of UIDs onto one log line. The
 * adjacent over_budget_series_count still carries the uncapped total, which is what
 * makes a truncated sample safe to read.
 */
const OVER_BUDGET_SERIES_UID_SAMPLE_SIZE = 20;

interface DestinationReconciliationScopeContext {
  authoritativeSourceWindows: ReadonlyMap<string, SyncWindow>;
  authoritativeWindow: SyncWindow | null;
  eventReadDiagnostics: DestinationEventReadDiagnostics;
  requestedWindow: SyncWindow;
  sourceCalendarIdsAtLocalRead: string[];
}

/*
 * A series withheld for exceeding the occurrence budget is absent from the local read
 * for a technical limit, not because the source dropped it. Reconciliation needs that
 * distinction, or every mirror of the series is deleted at the provider and re-added
 * the moment the series comes back under budget.
 */
const createDestinationReconciliationScope = (
  context: DestinationReconciliationScopeContext,
): ReconciliationScope => ({
  authoritativeSourceWindows: context.authoritativeSourceWindows,
  authoritativeWindow: context.authoritativeWindow,
  configuredSourceCalendarIds: new Set(context.sourceCalendarIdsAtLocalRead),
  requestedWindow: context.requestedWindow,
  withheldSourceEventStateIds: new Set(
    context.eventReadDiagnostics.overBudgetSourceEventStateIds,
  ),
});

const createDestinationReconciliationWideEventFields = (
  context: DestinationReconciliationContext,
): Record<string, string | number | boolean> => ({
  "local_event_states.candidate_count": context.eventReadDiagnostics.candidateEventStateCount,
  "local_event_states.excluded_by_sync_policy_count": context.eventReadDiagnostics.excludedBySyncPolicyCount,
  "local_event_states.materialized_count": context.eventReadDiagnostics.materializedEventCount,
  "local_event_states.missing_source_event_uid_count": context.eventReadDiagnostics.missingSourceEventUidCount,
  "local_event_states.outside_reconciliation_window_count": context.eventReadDiagnostics.outsideReconciliationWindowCount,
  "local_event_states.over_budget_series_count": context.eventReadDiagnostics.overBudgetSourceEventUids.length,
  "local_event_states.over_budget_series_uids": context.eventReadDiagnostics.overBudgetSourceEventUids
    .slice(0, OVER_BUDGET_SERIES_UID_SAMPLE_SIZE)
    .join(","),
  "local_event_states.syncable_count": context.eventReadDiagnostics.syncableEventCount,
  "reconciliation.local_read.duration_ms": context.localReadDurationMs,
  "reconciliation.remote_read.duration_ms": context.remoteReadDurationMs,
  "reconciliation.source_calendars.at_local_read_count": context.sourceCalendarIdsAtLocalRead.length,
  "reconciliation.source_calendars.before_remote_read_count": context.sourceCalendarIdsBeforeRemoteRead.length,
  "reconciliation.source_calendars.verified_count": context.verifiedSourceCalendarCount,
  "reconciliation.source_calendars.changed_during_remote_read": haveSourceCalendarsChanged(
    context.sourceCalendarIdsBeforeRemoteRead,
    context.sourceCalendarIdsAtLocalRead,
  ),
  "reconciliation.authority.verified": context.authoritativeWindow !== null,
  "reconciliation.window.requested_time_max": context.requestedWindow.timeMax.toISOString(),
  "reconciliation.window.requested_time_min": context.requestedWindow.timeMin.toISOString(),
  ...(context.authoritativeWindow && {
    "reconciliation.window.authoritative_time_max": context.authoritativeWindow.timeMax.toISOString(),
    "reconciliation.window.authoritative_time_min": context.authoritativeWindow.timeMin.toISOString(),
  }),
});

const readDestinationReconciliationState = async (
  readRemoteEvents: () => Promise<RemoteEvent[]>,
  readLocalState: () => Promise<DestinationLocalState>,
): Promise<DestinationLocalState & { remoteEvents: RemoteEvent[] }> => {
  const remoteEvents = await readRemoteEvents();
  const localState = await readLocalState();
  return { ...localState, remoteEvents };
};

interface CalendarSyncCompletion {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
  conflictsResolved: number;
  errors: string[];
  durationMs: number;
  syncEvent?: Record<string, unknown>;
}

interface CalendarSyncFailure {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  error: unknown;
  durationMs: number;
  syncEvent?: Record<string, unknown>;
}

interface SyncCallbacks {
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
  onCalendarComplete?: (completion: CalendarSyncCompletion) => void;
  onCalendarError?: (failure: CalendarSyncFailure) => void;
}

interface DestinationAttempt {
  accountId: string;
  calendarId: string;
  failureCount: number;
  nextAttemptAt: Date | null;
  provider: string;
  syncFutureRange: string;
  syncHistoricRange: string;
  userId: string;
}

const getDestinationAttempt = async (
  database: BunSQLDatabase,
  userId: string,
  calendarId: string,
): Promise<DestinationAttempt | null> => {
  const [destination] = await database
    .select({
      accountId: calendarsTable.accountId,
      calendarId: calendarsTable.id,
      failureCount: calendarsTable.failureCount,
      nextAttemptAt: calendarsTable.nextAttemptAt,
      provider: calendarAccountsTable.provider,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(and(
      eq(calendarsTable.userId, userId),
      eq(calendarsTable.id, calendarId),
      eq(calendarsTable.disabled, false),
      arrayContains(calendarsTable.capabilities, ["push"]),
    ))
    .limit(1);
  return destination ?? null;
};

const isDestinationAttemptEligible = (
  destination: DestinationAttempt,
  now: Date = new Date(),
): boolean =>
  destination.nextAttemptAt === null || destination.nextAttemptAt <= now;

/**
 * The conditions under which this worker must stop touching the destination
 * even though it still holds the lock. Read only by the in-flight check handed
 * to syncCalendar: the post-run verdict uses whether that check ever fired,
 * because a run that read both sides and found nothing to do returns the same
 * all-zero result as a run truncated at the gate, and re-reading the clock
 * afterwards cannot tell the two apart.
 */
const isDestinationAttemptSuperseded = (
  config: SyncConfig,
  sourceCalendarsChanged: boolean,
): boolean => {
  if (sourceCalendarsChanged) {
    return true;
  }
  if (config.abortSignal?.aborted === true) {
    return true;
  }
  if (!config.deadlineMs) {
    return false;
  }
  return Date.now() >= config.deadlineMs;
};

const resetDestinationBackoffIfNeeded = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  if (destination.failureCount > 0) {
    await resetDestinationBackoff(database, destination.calendarId);
  }
};

const hasSameRetryState = (
  observed: DestinationAttempt,
  current: DestinationAttempt | null,
): boolean =>
  current !== null
  && current.failureCount === observed.failureCount
  && (current.nextAttemptAt?.getTime() ?? null) === (observed.nextAttemptAt?.getTime() ?? null);

const escalateDestinationBackoff = async (
  database: BunSQLDatabase,
  destination: DestinationAttempt,
): Promise<void> => {
  const current = await getDestinationAttempt(
    database,
    destination.userId,
    destination.calendarId,
  );
  if (!hasSameRetryState(destination, current)) {
    return;
  }
  await applyDestinationBackoff(database, destination);
};

/**
 * The one place a run's verdict reaches the database, so the throwing and
 * non-throwing paths cannot disagree about who owns the calendar. Reports
 * whether this run still owned it, which is also the gate on folding the run's
 * counts and errors into the aggregate result.
 */
const applyDestinationAttemptVerdict = async (
  options: {
    database: BunSQLDatabase;
    destination: DestinationAttempt;
    handle: SyncLockHandle;
    verdict: DestinationAttemptVerdict;
  },
): Promise<boolean> => {
  const { database, destination, handle, verdict } = options;
  if (!await handle.isCurrent()) {
    return false;
  }
  if (verdict === "failed") {
    await escalateDestinationBackoff(database, destination);
  } else if (verdict === "succeeded") {
    await resetDestinationBackoffIfNeeded(database, destination);
  }
  return true;
};

/**
 * A run that lost the calendar mid-flight wrote no backoff, so it must not
 * announce one either: the worker turns onCalendarError into a
 * retry.backoff_applied claim, and the worker that still owns the calendar
 * reports the same run.
 */
const recordDestinationAttemptFailure = async (
  options: {
    callbacks?: SyncCallbacks;
    database: BunSQLDatabase;
    destination: DestinationAttempt;
    durationMs: number;
    error: unknown;
    handle: SyncLockHandle;
    syncEvent: Record<string, unknown> | null;
  },
): Promise<string[]> => {
  const { callbacks, database, destination, durationMs, error, handle, syncEvent } = options;
  const stillOwned = await applyDestinationAttemptVerdict({
    database,
    destination,
    handle,
    verdict: "failed",
  });
  if (!stillOwned) {
    return [];
  }

  callbacks?.onCalendarError?.({
    provider: destination.provider,
    accountId: destination.accountId,
    calendarId: destination.calendarId,
    userId: destination.userId,
    error,
    durationMs,
    ...(syncEvent && { syncEvent }),
  });
  return [getErrorMessage(error)];
};

const syncDestinationsForUser = async (
  userId: string,
  config: SyncConfig,
  callbacks?: SyncCallbacks,
): Promise<SyncDestinationsResult> => {
  const { database, redis } = config;

  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.id, config.destinationCalendarId),
        eq(calendarsTable.disabled, false),
        arrayContains(calendarsTable.capabilities, ["push"]),
      ),
    );

  if (destinations.length === 0) {
    return EMPTY_RESULT;
  }

  const syncLock = createSyncLock(redis, "background");

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;
  const errors: string[] = [];
  const syncEvents: Record<string, unknown>[] = [];

  for (const destinationCandidate of destinations) {
    if (config.abortSignal?.aborted) {
      break;
    }

    const lockResult = await syncLock.acquire(
      destinationCandidate.calendarId,
      config.abortSignal,
      createMappingMutationLockId(userId),
    );
    if (!lockResult.acquired) {
      continue;
    }

    const { handle } = lockResult;
    const calendarAttempt: {
      superseded: boolean;
      syncEvent: Record<string, unknown> | null;
    } = { superseded: false, syncEvent: null };
    let attemptedDestination: DestinationAttempt | null = null;

    try {
      const currentDestination = await getDestinationAttempt(
        database,
        userId,
        destinationCandidate.calendarId,
      );
      if (!currentDestination || !isDestinationAttemptEligible(currentDestination)) {
        continue;
      }
      const destination = currentDestination;
      attemptedDestination = destination;

      const syncProvider = await resolveSyncProvider({
        database,
        provider: destination.provider,
        calendarId: destination.calendarId,
        userId: destination.userId,
        accountId: destination.accountId,
        oauthConfig: config.oauthConfig,
        encryptionKey: config.encryptionKey,
        refreshLockStore: config.refreshLockStore,
        rateLimiter: createProviderRateLimiter(redis, userId, destination.provider),
        signal: config.abortSignal,
      });

      if (!syncProvider) {
        continue;
      }

      const providerRef = syncProvider;

      const sourceCalendarIds = await getMappedSourceCalendarIds(
        database,
        destination.calendarId,
      );
      /*
       * The stored ranges are the window, with no plan clamp applied here. Only a Pro
       * account can store a non-default range, so clamping at sync time adds no
       * enforcement — it only retroactively shrinks an already-synced window, and a
       * transient non-active subscription status would delete that history remotely.
       */
      const requestedWindow = getConfigurableSyncWindow(
        syncRangeSchema.assert(destination.syncHistoricRange),
        syncRangeSchema.assert(destination.syncFutureRange),
      );
      const initialSourceAuthority = await resolveSourceAuthority(
        database,
        sourceCalendarIds,
        requestedWindow,
      );
      let authoritativeSourceWindows = initialSourceAuthority.sourceWindows;
      let authoritativeWindow = initialSourceAuthority.aggregateWindow;
      let eventReadDiagnostics: DestinationEventReadDiagnostics = {
        candidateEventStateCount: 0,
        excludedBySyncPolicyCount: 0,
        materializedEventCount: 0,
        missingSourceEventUidCount: 0,
        overBudgetSourceEventStateIds: [],
        overBudgetSourceEventUids: [],
        outsideReconciliationWindowCount: 0,
        syncableEventCount: 0,
      };
      let localReadDurationMs = 0;
      let remoteReadDurationMs = 0;
      let sourceCalendarIdsAtLocalRead = sourceCalendarIds;
      let sourceCalendarsChangedDuringRemoteRead = false;
      const reconciliationState = await readDestinationReconciliationState(
        async () => {
          const startedAt = performance.now();
          try {
            return await providerRef.listRemoteEvents({
              timeMin: requestedWindow.timeMin,
            });
          } finally {
            remoteReadDurationMs = roundDuration(performance.now() - startedAt);
          }
        },
        async () => {
          const startedAt = performance.now();
          try {
            return await withSourceIngestLocks(
              database,
              sourceCalendarIds,
              async (lockedDatabase) => {
                sourceCalendarIdsAtLocalRead = await getMappedSourceCalendarIds(
                  lockedDatabase,
                  destination.calendarId,
                );
                sourceCalendarsChangedDuringRemoteRead = haveSourceCalendarsChanged(
                  sourceCalendarIds,
                  sourceCalendarIdsAtLocalRead,
                );
                if (sourceCalendarsChangedDuringRemoteRead) {
                  /*
                   * The replacement set is not covered by the locks acquired
                   * above. Supersede this run rather than reading an unlocked
                   * source snapshot or acquiring nested locks out of order.
                   */
                  authoritativeWindow = null;
                  authoritativeSourceWindows = new Map();
                  return { existingMappings: [], localEvents: [] };
                }
                /*
                 * Source coverage can shrink while the destination provider is
                 * being read. Re-read it under the source ingest locks and only
                 * narrow the original window. Expansions wait for the next run,
                 * because the remote read may not include the newly authoritative
                 * history yet.
                 */
                const currentSourceAuthority = await resolveSourceAuthority(
                  lockedDatabase,
                  sourceCalendarIdsAtLocalRead,
                  requestedWindow,
                );
                authoritativeSourceWindows = narrowSourceAuthority(
                  initialSourceAuthority.sourceWindows,
                  currentSourceAuthority.sourceWindows,
                );
                authoritativeWindow = createAggregateAuthorityWindow(
                  sourceCalendarIdsAtLocalRead,
                  authoritativeSourceWindows,
                  requestedWindow,
                );
                const localEvents: MaterializedSyncableEvent[] = [];
                const localReadWindow = getBoundingSourceAuthorityWindow(
                  authoritativeSourceWindows,
                );
                if (localReadWindow) {
                  const eventRead = await getEventsForCalendarsWithDiagnostics(
                    lockedDatabase,
                    [...authoritativeSourceWindows.keys()],
                    localReadWindow,
                  );
                  eventReadDiagnostics = eventRead.diagnostics;
                  localEvents.push(...eventRead.events);
                }
                return {
                  localEvents,
                  existingMappings: await getEventMappingsForDestination(
                    lockedDatabase,
                    destination.calendarId,
                  ),
                };
              },
            );
          } finally {
            localReadDurationMs = roundDuration(performance.now() - startedAt);
          }
        },
      );
      const reconciliationWideEventFields = createDestinationReconciliationWideEventFields({
        authoritativeWindow,
        eventReadDiagnostics,
        localReadDurationMs,
        requestedWindow,
        remoteReadDurationMs,
        sourceCalendarIdsAtLocalRead,
        sourceCalendarIdsBeforeRemoteRead: sourceCalendarIds,
        verifiedSourceCalendarCount: authoritativeSourceWindows.size,
      });
      const isAttemptCurrent = (): Promise<boolean> => {
        if (isDestinationAttemptSuperseded(config, sourceCalendarsChangedDuringRemoteRead)) {
          calendarAttempt.superseded = true;
          return Promise.resolve(false);
        }
        return handle.isCurrent();
      };
      const result = await syncCalendar({
        userId: destination.userId,
        calendarId: destination.calendarId,
        provider: providerRef,
        readState: () => Promise.resolve(reconciliationState),
        isCurrent: isAttemptCurrent,
        flush: createDatabaseFlush(database),
        onProgress: callbacks?.onProgress,
        onSyncEvent: (event) => {
          const enrichedEvent = {
            ...event,
            ...reconciliationWideEventFields,
            "provider.name": destination.provider,
            "provider.account_id": destination.accountId,
            "provider.calendar_id": destination.calendarId,
            "user.id": destination.userId,
          };
          calendarAttempt.syncEvent = enrichedEvent;
          syncEvents.push(enrichedEvent);
          if (callbacks?.onSyncEvent) {
            callbacks.onSyncEvent(enrichedEvent);
          }
        },
        reconciliationScope: createDestinationReconciliationScope({
          authoritativeSourceWindows,
          authoritativeWindow,
          eventReadDiagnostics,
          requestedWindow,
          sourceCalendarIdsAtLocalRead,
        }),
      });

      callbacks?.onCalendarComplete?.({
        provider: destination.provider,
        accountId: destination.accountId,
        calendarId: destination.calendarId,
        userId: destination.userId,
        added: result.added,
        addFailed: result.addFailed,
        removed: result.removed,
        removeFailed: result.removeFailed,
        conflictsResolved: result.conflictsResolved,
        errors: result.errors,
        durationMs: extractNumericField(calendarAttempt.syncEvent, "duration_ms"),
        ...(calendarAttempt.syncEvent && { syncEvent: calendarAttempt.syncEvent }),
      });

      const stillOwned = await applyDestinationAttemptVerdict({
        database,
        destination,
        handle,
        verdict: resolveDestinationAttemptVerdict(result, calendarAttempt.superseded),
      });
      if (!stillOwned) {
        continue;
      }

      added += result.added;
      addFailed += result.addFailed;
      removed += result.removed;
      removeFailed += result.removeFailed;
      errors.push(...result.errors);
    } catch (error) {
      const destination = attemptedDestination;
      if (!destination || !isBackoffEligibleError(error)) {
        throw error;
      }

      errors.push(...await recordDestinationAttemptFailure({
        callbacks,
        database,
        destination,
        durationMs: extractNumericField(calendarAttempt.syncEvent, "duration_ms"),
        error,
        handle,
        syncEvent: calendarAttempt.syncEvent,
      }));
    } finally {
      await handle.release();
    }
  }

  return { added, addFailed, removed, removeFailed, errors, syncEvents };
};

export {
  createDestinationReconciliationScope,
  createDestinationReconciliationWideEventFields,
  OVER_BUDGET_SERIES_UID_SAMPLE_SIZE,
  readDestinationReconciliationState,
  resolveStoredSourceCoverage,
  syncDestinationsForUser,
};
export type { CalendarSyncCompletion, CalendarSyncFailure, SyncConfig, SyncDestinationsResult };
