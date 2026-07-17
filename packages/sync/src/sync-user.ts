import {
  syncCalendar,
  getEventsForCalendars,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createRedisRateLimiter,
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
  getMappedSourceCalendarIds,
  withSourceIngestLocks,
  getOAuthSyncWindow,
} from "@keeper.sh/calendar";
import type { SyncProgressUpdate, RefreshLockStore } from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, isNull, lte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import { getErrorMessage, isBackoffEligibleError } from "./destination-errors";
import { resolveSyncProvider } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import { createSyncLock, isCalendarInvalidated } from "./sync-lock";

const GOOGLE_REQUESTS_PER_MINUTE = 500;
const DESTINATION_RECURRENCE_YEARS = 2;

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
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
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
      const reconciliationWindow = getOAuthSyncWindow(DESTINATION_RECURRENCE_YEARS);
      const result = await withSourceIngestLocks(database, sourceCalendarIds, (lockedDatabase) => syncCalendar({
        userId: destination.userId,
        calendarId: destination.calendarId,
        provider: providerRef,
        readState: async () => ({
          localEvents: await getEventsForCalendars(
            lockedDatabase,
            sourceCalendarIds,
            reconciliationWindow,
          ),
          existingMappings: await getEventMappingsForDestination(
            lockedDatabase,
            destination.calendarId,
          ),
          remoteEvents: await providerRef.listRemoteEvents({
            timeMin: reconciliationWindow.timeMin,
          }),
        }),
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
        flush: createDatabaseFlush(lockedDatabase),
        onProgress: callbacks?.onProgress,
        onSyncEvent: (event) => {
          const enrichedEvent = {
            ...event,
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
        },
      }));

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

export { syncDestinationsForUser };
export type { CalendarSyncCompletion, CalendarSyncFailure, SyncConfig, SyncDestinationsResult };
