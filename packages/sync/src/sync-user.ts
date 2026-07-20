import {
  syncCalendar,
  getEventsForCalendarsWithDiagnostics,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createRedisRateLimiter,
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
  getMappedSourceCalendarIds,
  withSourceIngestLocks,
  getOAuthSyncWindow,
  getConfigurableSyncWindow,
} from "@keeper.sh/calendar";
import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type {
  EventMapping,
  DestinationEventReadDiagnostics,
  MaterializedSyncableEvent,
  RefreshLockStore,
  RemoteEvent,
  SyncProgressUpdate,
} from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import { getErrorMessage, isBackoffEligibleError } from "./destination-errors";
import { resolveSyncProvider } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import { createSyncLock, isCalendarInvalidated } from "./sync-lock";

const GOOGLE_REQUESTS_PER_MINUTE = 500;

const resetDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set(RESET_CALENDAR_BACKOFF_STATE)
    .where(eq(calendarsTable.id, calendarId));
};

const applyDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
  currentFailureCount: number,
): Promise<void> => {
  const backoffState = buildCalendarBackoffState(currentFailureCount);

  await database
    .update(calendarsTable)
    .set(backoffState)
    .where(eq(calendarsTable.id, calendarId));
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
  reconciliationWindow: {
    timeMax: Date;
    timeMin: Date;
  };
  remoteReadDurationMs: number;
  sourceCalendarIdsAtLocalRead: string[];
  sourceCalendarIdsBeforeRemoteRead: string[];
}

const roundDuration = (durationMs: number): number =>
  Math.round(durationMs * 100) / 100;

const intersectWithSourceCoverage = async (
  database: Pick<BunSQLDatabase, "select">,
  sourceCalendarIds: string[],
  requestedWindow: { timeMin: Date; timeMax: Date },
): Promise<{ timeMin: Date; timeMax: Date }> => {
  if (sourceCalendarIds.length === 0) {
    return requestedWindow;
  }
  const fallbackWindow = getOAuthSyncWindow(2);
  const sources = await database
    .select({
      ingestWindowEnd: calendarsTable.ingestWindowEnd,
      ingestWindowStart: calendarsTable.ingestWindowStart,
    })
    .from(calendarsTable)
    .where(inArray(calendarsTable.id, sourceCalendarIds));

  let { timeMin, timeMax } = requestedWindow;
  for (const source of sources) {
    const candidate = source.ingestWindowStart ?? fallbackWindow.timeMin;
    if (candidate > timeMin) {
      timeMin = candidate;
    }
    const endCandidate = source.ingestWindowEnd ?? fallbackWindow.timeMax;
    if (endCandidate < timeMax) {
      timeMax = endCandidate;
    }
  }

  return { timeMin, timeMax };
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

const createDestinationReconciliationWideEventFields = (
  context: DestinationReconciliationContext,
): Record<string, string | number | boolean> => ({
  "local_event_states.candidate_count": context.eventReadDiagnostics.candidateEventStateCount,
  "local_event_states.excluded_by_sync_policy_count": context.eventReadDiagnostics.excludedBySyncPolicyCount,
  "local_event_states.materialized_count": context.eventReadDiagnostics.materializedEventCount,
  "local_event_states.missing_source_event_uid_count": context.eventReadDiagnostics.missingSourceEventUidCount,
  "local_event_states.outside_reconciliation_window_count": context.eventReadDiagnostics.outsideReconciliationWindowCount,
  "local_event_states.syncable_count": context.eventReadDiagnostics.syncableEventCount,
  "reconciliation.local_read.duration_ms": context.localReadDurationMs,
  "reconciliation.remote_read.duration_ms": context.remoteReadDurationMs,
  "reconciliation.source_calendars.at_local_read_count": context.sourceCalendarIdsAtLocalRead.length,
  "reconciliation.source_calendars.before_remote_read_count": context.sourceCalendarIdsBeforeRemoteRead.length,
  "reconciliation.source_calendars.changed_during_remote_read": haveSourceCalendarsChanged(
    context.sourceCalendarIdsBeforeRemoteRead,
    context.sourceCalendarIdsAtLocalRead,
  ),
  "reconciliation.window.recurrence_time_max": context.reconciliationWindow.timeMax.toISOString(),
  "reconciliation.window.time_min": context.reconciliationWindow.timeMin.toISOString(),
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

const syncDestinationsForUser = async (
  userId: string,
  config: SyncConfig,
  callbacks?: SyncCallbacks,
): Promise<SyncDestinationsResult> => {
  const { database, redis } = config;

  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
      userId: calendarsTable.userId,
      accountId: calendarsTable.accountId,
      failureCount: calendarsTable.failureCount,
      syncFutureRange: calendarsTable.syncFutureRange,
      syncHistoricRange: calendarsTable.syncHistoricRange,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.id, config.destinationCalendarId),
        eq(calendarsTable.disabled, false),
        arrayContains(calendarsTable.capabilities, ["push"]),
        or(
          isNull(calendarsTable.nextAttemptAt),
          lte(calendarsTable.nextAttemptAt, new Date()),
        ),
      ),
    );

  if (destinations.length === 0) {
    return EMPTY_RESULT;
  }

  const syncLock = createSyncLock(redis);

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;
  const errors: string[] = [];
  const syncEvents: Record<string, unknown>[] = [];

  const rateLimiter = createRedisRateLimiter(
    redis,
    `ratelimit:${userId}:google`,
    { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
  );

  for (const destination of destinations) {
    if (config.abortSignal?.aborted) {
      break;
    }

    const lockResult = await syncLock.acquire(destination.calendarId, config.abortSignal);
    if (!lockResult.acquired) {
      continue;
    }

    const { handle } = lockResult;
    const calendarAttempt: { syncEvent: Record<string, unknown> | null } = { syncEvent: null };

    try {
      const syncProvider = await resolveSyncProvider({
        database,
        provider: destination.provider,
        calendarId: destination.calendarId,
        userId: destination.userId,
        accountId: destination.accountId,
        oauthConfig: config.oauthConfig,
        encryptionKey: config.encryptionKey,
        refreshLockStore: config.refreshLockStore,
        rateLimiter,
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
      const requestedWindow = getConfigurableSyncWindow(
        syncRangeSchema.assert(destination.syncHistoricRange),
        syncRangeSchema.assert(destination.syncFutureRange),
      );
      const initialReconciliationWindow = await intersectWithSourceCoverage(
        database,
        sourceCalendarIds,
        requestedWindow,
      );
      let reconciliationWindow = initialReconciliationWindow;
      let eventReadDiagnostics: DestinationEventReadDiagnostics = {
        candidateEventStateCount: 0,
        excludedBySyncPolicyCount: 0,
        materializedEventCount: 0,
        missingSourceEventUidCount: 0,
        outsideReconciliationWindowCount: 0,
        syncableEventCount: 0,
      };
      let localReadDurationMs = 0;
      let remoteReadDurationMs = 0;
      let sourceCalendarIdsAtLocalRead = sourceCalendarIds;
      const reconciliationState = await readDestinationReconciliationState(
        async () => {
          const startedAt = performance.now();
          try {
            return await providerRef.listRemoteEvents({
              timeMin: initialReconciliationWindow.timeMin,
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
                /*
                 * Source coverage can shrink while the destination provider is
                 * being read. Re-read it under the source ingest locks and only
                 * narrow the original window. Expansions wait for the next run,
                 * because the remote read may not include the newly authoritative
                 * history yet.
                 */
                reconciliationWindow = await intersectWithSourceCoverage(
                  lockedDatabase,
                  sourceCalendarIds,
                  initialReconciliationWindow,
                );
                const eventRead = await getEventsForCalendarsWithDiagnostics(
                  lockedDatabase,
                  sourceCalendarIds,
                  reconciliationWindow,
                );
                eventReadDiagnostics = eventRead.diagnostics;
                return {
                  localEvents: eventRead.events,
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
        eventReadDiagnostics,
        localReadDurationMs,
        reconciliationWindow,
        remoteReadDurationMs,
        sourceCalendarIdsAtLocalRead,
        sourceCalendarIdsBeforeRemoteRead: sourceCalendarIds,
      });
      const result = await syncCalendar({
        userId: destination.userId,
        calendarId: destination.calendarId,
        provider: providerRef,
        readState: () => Promise.resolve(reconciliationState),
        isCurrent: () => {
          if (config.abortSignal?.aborted) {
            return Promise.resolve(false);
          }
          if (config.deadlineMs && Date.now() >= config.deadlineMs) {
            return Promise.resolve(false);
          }
          return handle.isCurrent();
        },
        isInvalidated: () => isCalendarInvalidated(redis, destination.calendarId),
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
        timeBoundary: {
          syncWindowStart: reconciliationWindow.timeMin,
          syncWindowEnd: reconciliationWindow.timeMax,
          cleanupWindowStart: requestedWindow.timeMin,
          cleanupWindowEnd: requestedWindow.timeMax,
        },
      });

      if (callbacks?.onCalendarComplete) {
        callbacks.onCalendarComplete({
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
      }

      if (!(await handle.isCurrent())) {
        continue;
      }

      const invalidated = await isCalendarInvalidated(redis, destination.calendarId);
      if (invalidated) {
        continue;
      }

      if (destination.failureCount > 0) {
        await resetDestinationBackoff(database, destination.calendarId);
      }

      added += result.added;
      addFailed += result.addFailed;
      removed += result.removed;
      removeFailed += result.removeFailed;
      errors.push(...result.errors);
    } catch (error) {
      if (!isBackoffEligibleError(error)) {
        throw error;
      }

      await applyDestinationBackoff(database, destination.calendarId, destination.failureCount);
      errors.push(getErrorMessage(error));
      callbacks?.onCalendarError?.({
        provider: destination.provider,
        accountId: destination.accountId,
        calendarId: destination.calendarId,
        userId: destination.userId,
        error,
        durationMs: extractNumericField(calendarAttempt.syncEvent, "duration_ms"),
        ...(calendarAttempt.syncEvent && { syncEvent: calendarAttempt.syncEvent }),
      });
    } finally {
      await handle.release();
    }
  }

  return { added, addFailed, removed, removeFailed, errors, syncEvents };
};

export {
  createDestinationReconciliationWideEventFields,
  readDestinationReconciliationState,
  syncDestinationsForUser,
};
export type { CalendarSyncCompletion, CalendarSyncFailure, SyncConfig, SyncDestinationsResult };
