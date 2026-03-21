import {
  createDatabaseFlush,
  createRedisRateLimiter,
  getEventMappingsForDestination,
  getEventsForDestination,
  syncCalendar,
} from "@keeper.sh/calendar";
import type { RefreshLockStore, SyncProgressUpdate } from "@keeper.sh/calendar";
import {
  createDestinationExecutionRuntime,
  type DestinationExecutionDispatchResult,
  type DestinationExecutionRuntimeEvent,
  RuntimeInvariantViolationError,
  RedisCommandOutboxStore,
} from "@keeper.sh/machine-orchestration";
import {
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import type { DestinationExecutionEvent } from "@keeper.sh/state-machines";
import { and, arrayContains, eq, isNull, lte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";
import type { CredentialHealthRuntimeEvent } from "./credential-health-runtime";
import {
  mapDestinationExecutionFailureEvent,
  DestinationExecutionFailureClassification,
} from "./destination-execution-failure-event";
import { resolveDestinationFailureOutput } from "./destination-failure-policy";
import {
  buildCalendarFailure,
  DispatchConflictCode,
  handleDispatchConflict,
} from "./dispatch-conflict-policy";
import type { CalendarSyncFailure } from "./dispatch-conflict-policy";
import type { OAuthConfig } from "./resolve-provider";
import { ProviderResolutionStatus, resolveSyncProviderOutcome } from "./resolve-provider";
import { createSyncLock, isCalendarInvalidated } from "./sync-lock";
import {
  createProviderResolutionFailedStep,
  createStartupDispatchSteps,
  isUnresolvedProviderStatus,
} from "./keeper-sync-runtime-dispatch-table";

const GOOGLE_REQUESTS_PER_MINUTE = 500;

interface KeeperSyncRuntimeConfig {
  abortSignal?: AbortSignal;
  database: BunSQLDatabase;
  deadlineMs?: number;
  encryptionKey?: string;
  oauthConfig: OAuthConfig;
  redis: Redis;
  refreshLockStore: RefreshLockStore | null;
}

interface KeeperSyncRuntimeResult {
  addFailed: number;
  added: number;
  errors: string[];
  removeFailed: number;
  removed: number;
  syncEvents: Record<string, unknown>[];
}

interface CalendarSyncCompletion {
  accountId: string;
  addFailed: number;
  added: number;
  calendarId: string;
  durationMs: number;
  errors: string[];
  provider: string;
  removeFailed: number;
  removed: number;
  userId: string;
}

interface SyncDestination {
  accountId: string;
  calendarId: string;
  failureCount: number;
  provider: string;
  userId: string;
}

interface SyncCallbacks {
  onCalendarComplete?: (completion: CalendarSyncCompletion) => Promise<void> | void;
  onCalendarFailed?: (failure: CalendarSyncFailure) => Promise<void> | void;
  onCredentialRuntimeEvent?: (
    calendarId: string,
    event: CredentialHealthRuntimeEvent,
  ) => Promise<void> | void;
  onDestinationRuntimeEvent?: (
    calendarId: string,
    event: DestinationExecutionRuntimeEvent,
  ) => Promise<void> | void;
  onProgress?: (update: SyncProgressUpdate) => void;
  onSyncEvent?: (event: Record<string, unknown>) => void;
}

interface DestinationRuntimePort {
  dispatch: (event: DestinationExecutionEvent) => Promise<DestinationExecutionDispatchResult>;
  releaseIfHeld: () => Promise<void>;
}

interface DispatchWithConflictInput {
  conflictCode: DispatchConflictCode;
  destination: SyncDestination;
  event: DestinationExecutionEvent;
  notifyCalendarFailed: (failure: CalendarSyncFailure) => Promise<void>;
  runtime: DestinationRuntimePort;
  startedAtMs: number;
}

const EMPTY_RESULT: KeeperSyncRuntimeResult = {
  addFailed: 0,
  added: 0,
  errors: [],
  removeFailed: 0,
  removed: 0,
  syncEvents: [],
};

const extractNumericField = (
  event: Record<string, unknown> | undefined,
  key: string,
): number => {
  if (!event) {
    return 0;
  }

  const value = event[key];
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

const resetDestinationBackoff = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null })
    .where(eq(calendarsTable.id, calendarId));
};

const createIsCurrentResolver = (input: {
  abortSignal?: AbortSignal;
  deadlineMs?: number;
  isCurrent: () => Promise<boolean>;
}): (() => Promise<boolean>) =>
  () => {
    if (input.abortSignal?.aborted) {
      return Promise.resolve(false);
    }

    if (input.deadlineMs && Date.now() >= input.deadlineMs) {
      return Promise.resolve(false);
    }

    return input.isCurrent();
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

const dispatchWithConflictHandling = async (
  input: DispatchWithConflictInput,
): Promise<{
  conflictHandled: boolean;
  result: DestinationExecutionDispatchResult;
}> => {
  const result = await input.runtime.dispatch(input.event);
  const conflictHandled = await handleDispatchConflict({
    conflictCode: input.conflictCode,
    destination: input.destination,
    notifyCalendarFailed: input.notifyCalendarFailed,
    result,
    runtime: input.runtime,
    startedAtMs: input.startedAtMs,
  });

  return { conflictHandled, result };
};

const runStartupDispatchSteps = async (input: {
  calendarId: string;
  destination: SyncDestination;
  notifyCalendarFailed: (failure: CalendarSyncFailure) => Promise<void>;
  runtime: DestinationRuntimePort;
  startedAtMs: number;
}): Promise<boolean> => {
  const steps = createStartupDispatchSteps(input.calendarId);
  for (const step of steps) {
    const startupDispatchResult = await dispatchWithConflictHandling({
      conflictCode: step.conflictCode,
      destination: input.destination,
      event: step.event,
      notifyCalendarFailed: input.notifyCalendarFailed,
      runtime: input.runtime,
      startedAtMs: input.startedAtMs,
    });

    if (startupDispatchResult.conflictHandled) {
      return true;
    }
  }

  return false;
};

const runKeeperSyncRuntimeForUser = async (
  userId: string,
  config: KeeperSyncRuntimeConfig,
  callbacks?: SyncCallbacks,
): Promise<KeeperSyncRuntimeResult> => {
  const { database, redis } = config;
  const destinations: SyncDestination[] = await database
    .select({
      accountId: calendarsTable.accountId,
      calendarId: calendarsTable.id,
      failureCount: calendarsTable.failureCount,
      provider: calendarAccountsTable.provider,
      userId: calendarsTable.userId,
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
  const rateLimiter = createRedisRateLimiter(
    redis,
    `ratelimit:${userId}:google`,
    { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
  );

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;
  const errors: string[] = [];
  const syncEvents: Record<string, unknown>[] = [];

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
      onRuntimeEvent: (event) => callbacks?.onDestinationRuntimeEvent?.(destination.calendarId, event),
      outboxStore: new RedisCommandOutboxStore({
        keyPrefix: "machine:outbox:destination-execution",
        redis,
      }),
    });

    try {
      const startupConflictHandled = await runStartupDispatchSteps({
        calendarId: destination.calendarId,
        destination,
        notifyCalendarFailed,
        runtime: destinationRuntime,
        startedAtMs: calendarSyncStartedAt,
      });
      if (startupConflictHandled) {
        continue;
      }

      const syncProviderOutcome = await resolveSyncProviderOutcome({
        accountId: destination.accountId,
        calendarId: destination.calendarId,
        database,
        encryptionKey: config.encryptionKey,
        oauthConfig: config.oauthConfig,
        onCredentialRuntimeEvent: callbacks?.onCredentialRuntimeEvent,
        outboxRedis: redis,
        provider: destination.provider,
        rateLimiter,
        refreshLockStore: config.refreshLockStore,
        signal: config.abortSignal,
        userId: destination.userId,
      });

      if (syncProviderOutcome.status !== ProviderResolutionStatus.RESOLVED) {
        if (!isUnresolvedProviderStatus(syncProviderOutcome.status)) {
          throw new RuntimeInvariantViolationError({
            aggregateId: destination.calendarId,
            code: "DESTINATION_PROVIDER_RESOLUTION_STATUS_INVALID",
            reason: `unexpected provider resolution status: ${syncProviderOutcome.status}`,
            surface: "keeper-sync-runtime",
          });
        }

        const providerResolutionFailedStep = createProviderResolutionFailedStep(
          syncProviderOutcome.status,
        );
        const providerResolutionDispatchResult = await dispatchWithConflictHandling({
          conflictCode: providerResolutionFailedStep.conflictCode,
          destination,
          event: providerResolutionFailedStep.event,
          notifyCalendarFailed,
          runtime: destinationRuntime,
          startedAtMs: calendarSyncStartedAt,
        });

        if (providerResolutionDispatchResult.conflictHandled) {
          continue;
        }

        const { result: failedResult } = providerResolutionDispatchResult;
        if (failedResult.outcome !== "TRANSITION_APPLIED") {
          throw new RuntimeInvariantViolationError({
            aggregateId: destination.calendarId,
            code: "DESTINATION_FATAL_FAILURE_TRANSITION_MISSING",
            reason: "fatal failure dispatch did not apply a transition",
            surface: "keeper-sync-runtime",
          });
        }

        const failedPolicy = resolveDestinationFailureOutput(failedResult.transition.outputs);
        await notifyCalendarFailed(
          buildCalendarFailure({
            destination,
            disabled: failedPolicy.disabled,
            error: syncProviderOutcome.status,
            retryable: failedPolicy.retryable,
            startedAtMs: calendarSyncStartedAt,
          }),
        );
        continue;
      }

      const providerRef = syncProviderOutcome.provider;
      const result = await syncCalendar({
        calendarId: destination.calendarId,
        flush,
        isCurrent: createIsCurrentResolver({
          abortSignal: config.abortSignal,
          deadlineMs: config.deadlineMs,
          isCurrent: () => handle.isCurrent(),
        }),
        isInvalidated: () => isCalendarInvalidated(redis, destination.calendarId),
        onProgress: callbacks?.onProgress,
        onSyncEvent: (event) => {
          const enrichedEvent = {
            ...event,
            "destination.provider": destination.provider,
            "user.id": destination.userId,
          };
          syncEvents.push(enrichedEvent);
          callbacks?.onSyncEvent?.(enrichedEvent);
        },
        provider: providerRef,
        readState: async () => ({
          existingMappings: await getEventMappingsForDestination(database, destination.calendarId),
          localEvents: await getEventsForDestination(database, destination.calendarId),
          remoteEvents: await providerRef.listRemoteEvents(),
        }),
        userId: destination.userId,
      });

      const invalidated = await isCalendarInvalidated(redis, destination.calendarId);
      if (invalidated) {
        await dispatchWithConflictHandling({
          conflictCode: DispatchConflictCode.INVALIDATION_DETECTED,
          destination,
          event: {
            at: new Date().toISOString(),
            type: "INVALIDATION_DETECTED",
          },
          notifyCalendarFailed,
          runtime: destinationRuntime,
          startedAtMs: calendarSyncStartedAt,
        });
        continue;
      }

      if (destination.failureCount > 0) {
        await resetDestinationBackoff(database, destination.calendarId);
      }

      const successDispatchResult = await dispatchWithConflictHandling({
        conflictCode: DispatchConflictCode.EXECUTION_SUCCEEDED,
        destination,
        event: {
          eventsAdded: result.added,
          eventsRemoved: result.removed,
          type: "EXECUTION_SUCCEEDED",
        },
        notifyCalendarFailed,
        runtime: destinationRuntime,
        startedAtMs: calendarSyncStartedAt,
      });
      if (successDispatchResult.conflictHandled) {
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
          accountId: destination.accountId,
          addFailed: result.addFailed,
          added: result.added,
          calendarId: destination.calendarId,
          errors: result.errors,
          provider: destination.provider,
          removeFailed: result.removeFailed,
          removed: result.removed,
          userId: destination.userId,
        },
        syncEvents,
      });
    } catch (error) {
      const mappedFailure = mapDestinationExecutionFailureEvent(
        error,
        new Date().toISOString(),
      );
      const failureResult = await destinationRuntime.dispatch(mappedFailure.event);
      const executionFailureConflict = await handleDispatchConflict({
        conflictCode: DispatchConflictCode.EXECUTION_FAILED,
        destination,
        notifyCalendarFailed,
        result: failureResult,
        runtime: destinationRuntime,
        startedAtMs: calendarSyncStartedAt,
      });
      if (executionFailureConflict) {
        continue;
      }

      if (failureResult.outcome !== "TRANSITION_APPLIED") {
        await notifyCalendarFailed(
          buildCalendarFailure({
            destination,
            disabled: false,
            error: DispatchConflictCode.EXECUTION_FAILED,
            retryable: true,
            startedAtMs: calendarSyncStartedAt,
          }),
        );
        continue;
      }

      const failurePolicy = resolveDestinationFailureOutput(failureResult.transition.outputs);
      errors.push(mappedFailure.errorMessage);
      await notifyCalendarFailed(
        buildCalendarFailure({
          destination,
          disabled: failurePolicy.disabled,
          error: mappedFailure.errorMessage,
          retryable: failurePolicy.retryable,
          startedAtMs: calendarSyncStartedAt,
        }),
      );

      if (mappedFailure.classification === DestinationExecutionFailureClassification.TERMINAL) {
        throw error;
      }
    }
  }

  return { addFailed, added, errors, removeFailed, removed, syncEvents };
};

export { runKeeperSyncRuntimeForUser };
export type {
  CalendarSyncCompletion,
  CalendarSyncFailure,
  KeeperSyncRuntimeConfig,
  KeeperSyncRuntimeResult,
};
