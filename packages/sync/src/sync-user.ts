import {
  syncCalendar,
  getEventsForDestination,
  getEventMappingsForDestination,
  createDatabaseFlush,
  createRedisRateLimiter,
} from "@keeper.sh/calendar";
import type { SyncProgressUpdate, RefreshLockStore } from "@keeper.sh/calendar";
import { RedisCommandOutboxStore } from "@keeper.sh/machine-orchestration";
import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq, isNull, lte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import { createDestinationExecutionRuntime } from "./destination-execution-runtime";
import type { DestinationExecutionDispatchResult } from "./destination-execution-runtime";
import type { DestinationExecutionRuntimeEvent } from "./destination-execution-runtime";
import { resolveDestinationFailureOutput } from "./destination-failure-policy";
import {
  DestinationExecutionFailureClassification,
  mapDestinationExecutionFailureEvent,
} from "./destination-execution-failure-event";
import { resolveSyncProviderOutcome, ProviderResolutionStatus } from "./resolve-provider";
import type { OAuthConfig } from "./resolve-provider";
import type { CredentialHealthRuntimeEvent } from "./credential-health-runtime";
import { createSyncLock, isCalendarInvalidated } from "./sync-lock";

const GOOGLE_REQUESTS_PER_MINUTE = 500;

const resetDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null })
    .where(eq(calendarsTable.id, calendarId));
};

const extractNumericField = (event: Record<string, unknown> | undefined, key: string): number => {
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
  refreshLockStore: RefreshLockStore | null;
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
  errors: string[];
  durationMs: number;
}

interface CalendarSyncFailure {
  provider: string;
  accountId: string;
  calendarId: string;
  userId: string;
  error: string;
  durationMs: number;
  retryable: boolean;
  disabled: boolean;
}

interface SyncDestination {
  accountId: string;
  calendarId: string;
  failureCount: number;
  provider: string;
  userId: string;
}

interface SyncCallbacks {
  onSyncEvent?: (event: Record<string, unknown>) => void;
  onProgress?: (update: SyncProgressUpdate) => void;
  onCalendarComplete?: (completion: CalendarSyncCompletion) => Promise<void> | void;
  onCalendarFailed?: (failure: CalendarSyncFailure) => Promise<void> | void;
  onDestinationRuntimeEvent?: (
    calendarId: string,
    event: DestinationExecutionRuntimeEvent,
  ) => Promise<void> | void;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
}

const createIsCurrentResolver = (
  input: {
    abortSignal?: AbortSignal;
    deadlineMs?: number;
    isCurrent: () => Promise<boolean>;
  },
): (() => Promise<boolean>) =>
  () => {
    if (input.abortSignal?.aborted) {
      return Promise.resolve(false);
    }
    if (input.deadlineMs && Date.now() >= input.deadlineMs) {
      return Promise.resolve(false);
    }
    return input.isCurrent();
  };

interface HandleDispatchConflictInput {
  result: DestinationExecutionDispatchResult;
  runtime: ReturnType<typeof createDestinationExecutionRuntime>;
  destination: SyncDestination;
  startedAtMs: number;
  conflictCode: string;
  notifyCalendarFailed: (failure: CalendarSyncFailure) => Promise<void>;
}

interface BuildCalendarFailureInput {
  destination: SyncDestination;
  startedAtMs: number;
  error: string;
  retryable: boolean;
  disabled: boolean;
}

const buildCalendarFailure = (input: BuildCalendarFailureInput): CalendarSyncFailure => ({
  provider: input.destination.provider,
  accountId: input.destination.accountId,
  calendarId: input.destination.calendarId,
  userId: input.destination.userId,
  error: input.error,
  durationMs: Date.now() - input.startedAtMs,
  retryable: input.retryable,
  disabled: input.disabled,
});

const handleDispatchConflict = async (
  input: HandleDispatchConflictInput,
): Promise<boolean> => {
  if (input.result.outcome === "TRANSITION_APPLIED") {
    return false;
  }
  await input.runtime.releaseIfHeld();
  await input.notifyCalendarFailed(
    buildCalendarFailure({
      destination: input.destination,
      startedAtMs: input.startedAtMs,
      error: input.conflictCode,
      retryable: true,
      disabled: false,
    }),
  );
  return true;
};

const notifyCalendarCompleteIfNeeded = async (input: {
  callbacks?: SyncCallbacks;
  completion: Omit<CalendarSyncCompletion, "durationMs">;
  syncEvents: Record<string, unknown>[];
}): Promise<void> => {
  if (!input.callbacks?.onCalendarComplete) {
    return;
  }
  const syncEvent = input.syncEvents.at(-1);
  const durationMs = extractNumericField(syncEvent, "duration_ms");
  await input.callbacks.onCalendarComplete({
    ...input.completion,
    durationMs,
  });
};

const syncDestinationsForUser = async (
  userId: string,
  config: SyncConfig,
  callbacks?: SyncCallbacks,
): Promise<SyncDestinationsResult> => {
  const { database, redis } = config;

  const destinations: SyncDestination[] = await database
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
        eq(calendarAccountsTable.needsReauthentication, false),
        or(
          isNull(calendarsTable.nextAttemptAt),
          lte(calendarsTable.nextAttemptAt, new Date()),
        ),
      ),
    );

  if (destinations.length === 0) {
    return EMPTY_RESULT;
  }

  const flush = createDatabaseFlush(database);
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
  const notifyCalendarFailed = (failure: CalendarSyncFailure): Promise<void> => {
    if (!callbacks?.onCalendarFailed) {
      return Promise.resolve();
    }
    return Promise.resolve(callbacks.onCalendarFailed(failure));
  };

  for (const destination of destinations) {
    if (config.abortSignal?.aborted) {
      break;
    }

    const calendarSyncStartedAt = Date.now();
    const lockResult = await syncLock.acquire(destination.calendarId);
    if (!lockResult.acquired) {
      continue;
    }

    const { handle } = lockResult;
    let envelopeSequence = 0;
    const destinationRuntime = createDestinationExecutionRuntime({
      calendarId: destination.calendarId,
      createEnvelope: (event) => {
        envelopeSequence += 1;
        return {
          actor: { id: "sync-runtime", type: "system" },
          event,
          id: `${destination.calendarId}:${envelopeSequence}:${event.type}`,
          occurredAt: new Date().toISOString(),
        };
      },
      failureCount: destination.failureCount,
      handlers: {
        applyBackoff: async (nextAttemptAt) => {
          await database
            .update(calendarsTable)
            .set({
              failureCount: destination.failureCount + 1,
              lastFailureAt: new Date(),
              nextAttemptAt: new Date(nextAttemptAt),
            })
            .where(eq(calendarsTable.id, destination.calendarId));
        },
        disableDestination: async () => {
          await database
            .update(calendarsTable)
            .set({
              disabled: true,
              failureCount: destination.failureCount + 1,
              lastFailureAt: new Date(),
              nextAttemptAt: null,
            })
            .where(eq(calendarsTable.id, destination.calendarId));
        },
        emitSyncEvent: () => Promise.resolve(),
        releaseLock: async () => {
          await handle.release();
        },
      },
      outboxStore: new RedisCommandOutboxStore({
        keyPrefix: "machine:outbox:destination-execution",
        redis,
      }),
      onRuntimeEvent: (event) => {
        if (callbacks?.onDestinationRuntimeEvent) {
          return callbacks.onDestinationRuntimeEvent(destination.calendarId, event);
        }
      },
    });

    try {
      const lockAcquiredResult = await destinationRuntime.dispatch({
        holderId: destination.calendarId,
        type: "LOCK_ACQUIRED",
      });
      const lockAcquireConflict = await handleDispatchConflict({
        result: lockAcquiredResult,
        runtime: destinationRuntime,
        destination,
        startedAtMs: calendarSyncStartedAt,
        conflictCode: "machine_conflict_lock_acquired",
        notifyCalendarFailed,
      });
      if (lockAcquireConflict) {
        continue;
      }

      const executionStartedResult = await destinationRuntime.dispatch({ type: "EXECUTION_STARTED" });
      const executionStartConflict = await handleDispatchConflict({
        result: executionStartedResult,
        runtime: destinationRuntime,
        destination,
        startedAtMs: calendarSyncStartedAt,
        conflictCode: "machine_conflict_execution_started",
        notifyCalendarFailed,
      });
      if (executionStartConflict) {
        continue;
      }

      const syncProviderOutcome = await resolveSyncProviderOutcome({
        database,
        provider: destination.provider,
        calendarId: destination.calendarId,
        userId: destination.userId,
        accountId: destination.accountId,
        oauthConfig: config.oauthConfig,
        outboxRedis: redis,
        encryptionKey: config.encryptionKey,
        refreshLockStore: config.refreshLockStore,
        rateLimiter,
        signal: config.abortSignal,
        onCredentialRuntimeEvent: callbacks?.onCredentialRuntimeEvent,
      });

      if (syncProviderOutcome.status !== ProviderResolutionStatus.RESOLVED) {
        const code = syncProviderOutcome.status.toLowerCase();
        const failedResult = await destinationRuntime.dispatch({
          code,
          reason: code,
          type: "EXECUTION_FATAL_FAILED",
        });
        const providerResolutionFailureConflict = await handleDispatchConflict({
          result: failedResult,
          runtime: destinationRuntime,
          destination,
          startedAtMs: calendarSyncStartedAt,
          conflictCode: "machine_conflict_provider_resolution_failed",
          notifyCalendarFailed,
        });
        if (providerResolutionFailureConflict) {
          continue;
        }
        if (failedResult.outcome !== "TRANSITION_APPLIED") {
          throw new RuntimeInvariantViolationError({
            aggregateId: destination.calendarId,
            code: "DESTINATION_FATAL_FAILURE_TRANSITION_MISSING",
            reason: "fatal failure dispatch did not apply a transition",
            surface: "sync-user",
          });
        }
        const failedPolicy = resolveDestinationFailureOutput(failedResult.transition.outputs);
        await notifyCalendarFailed(
          buildCalendarFailure({
            destination,
            startedAtMs: calendarSyncStartedAt,
            error: code,
            retryable: failedPolicy.retryable,
            disabled: failedPolicy.disabled,
          }),
        );
        continue;
      }

      const providerRef = syncProviderOutcome.provider;

        const result = await syncCalendar({
        userId: destination.userId,
        calendarId: destination.calendarId,
        provider: providerRef,
        readState: async () => ({
          localEvents: await getEventsForDestination(database, destination.calendarId),
          existingMappings: await getEventMappingsForDestination(database, destination.calendarId),
          remoteEvents: await providerRef.listRemoteEvents(),
        }),
          isCurrent: createIsCurrentResolver({
            abortSignal: config.abortSignal,
            deadlineMs: config.deadlineMs,
            isCurrent: () => handle.isCurrent(),
          }),
        isInvalidated: () => isCalendarInvalidated(redis, destination.calendarId),
        flush,
        onProgress: callbacks?.onProgress,
        onSyncEvent: (event) => {
          const enrichedEvent = {
            ...event,
            "destination.provider": destination.provider,
            "user.id": destination.userId,
          };
          syncEvents.push(enrichedEvent);
          if (callbacks?.onSyncEvent) {
            callbacks.onSyncEvent(enrichedEvent);
          }
        },
      });

      const invalidated = await isCalendarInvalidated(redis, destination.calendarId);
      if (invalidated) {
        const invalidationResult = await destinationRuntime.dispatch({
          at: new Date().toISOString(),
          type: "INVALIDATION_DETECTED",
        });
        await handleDispatchConflict({
          result: invalidationResult,
          runtime: destinationRuntime,
          destination,
          startedAtMs: calendarSyncStartedAt,
          conflictCode: "machine_conflict_invalidation_detected",
          notifyCalendarFailed,
        });
        continue;
      }

      if (destination.failureCount > 0) {
        await resetDestinationBackoff(database, destination.calendarId);
      }

      const successResult = await destinationRuntime.dispatch({
        eventsAdded: result.added,
        eventsRemoved: result.removed,
        type: "EXECUTION_SUCCEEDED",
      });
      const executionSuccessConflict = await handleDispatchConflict({
        result: successResult,
        runtime: destinationRuntime,
        destination,
        startedAtMs: calendarSyncStartedAt,
        conflictCode: "machine_conflict_execution_succeeded",
        notifyCalendarFailed,
      });
      if (executionSuccessConflict) {
        continue;
      }

      added += result.added;
      addFailed += result.addFailed;
      removed += result.removed;
      removeFailed += result.removeFailed;
      errors.push(...result.errors);

        await notifyCalendarCompleteIfNeeded({
          callbacks,
          completion: {
            provider: destination.provider,
            accountId: destination.accountId,
            calendarId: destination.calendarId,
            userId: destination.userId,
            added: result.added,
            addFailed: result.addFailed,
            removed: result.removed,
            removeFailed: result.removeFailed,
            errors: result.errors,
          },
          syncEvents,
        });
    } catch (error) {
      const mappedFailure = mapDestinationExecutionFailureEvent(
        error,
        new Date().toISOString(),
      );
      const failureResult: DestinationExecutionDispatchResult =
        await destinationRuntime.dispatch(mappedFailure.event);
      const executionFailureConflict = await handleDispatchConflict({
        result: failureResult,
        runtime: destinationRuntime,
        destination,
        startedAtMs: calendarSyncStartedAt,
        conflictCode: "machine_conflict_execution_failed",
        notifyCalendarFailed,
      });
      if (executionFailureConflict) {
        continue;
      }
      if (failureResult.outcome !== "TRANSITION_APPLIED") {
        await notifyCalendarFailed(
          buildCalendarFailure({
            destination,
            startedAtMs: calendarSyncStartedAt,
            error: "machine_conflict_execution_failed",
            retryable: true,
            disabled: false,
          }),
        );
        continue;
      }
      const failurePolicy = resolveDestinationFailureOutput(failureResult.transition.outputs);
      errors.push(mappedFailure.errorMessage);
      await notifyCalendarFailed(
        buildCalendarFailure({
          destination,
          startedAtMs: calendarSyncStartedAt,
          error: mappedFailure.errorMessage,
          retryable: failurePolicy.retryable,
          disabled: failurePolicy.disabled,
        }),
      );
      if (
        mappedFailure.classification
        === DestinationExecutionFailureClassification.TERMINAL
      ) {
        throw error;
      }
    }
  }

  return { added, addFailed, removed, removeFailed, errors, syncEvents };
};

export { syncDestinationsForUser };
export type {
  CalendarSyncCompletion,
  CalendarSyncFailure,
  SyncConfig,
  SyncDestinationsResult,
};
