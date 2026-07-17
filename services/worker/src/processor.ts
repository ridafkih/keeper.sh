import type { Job } from "bullmq";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";
import type { DestinationSyncResult } from "@keeper.sh/calendar";
import { createSyncAggregateRuntime, mergeAbortSignals } from "@keeper.sh/calendar";
import { syncDestinationsForUser, SyncLockRenewalError } from "@keeper.sh/sync";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { database, refreshLockRedis, refreshLockStore } from "./context";
import { context, widelog } from "./utils/logging";
import env from "./env";

const resolveCount = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const resolveErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error.error === "string") {
    return error.error;
  }
  return String(error);
};

const resolveErrorStatusCode = (error: unknown): number | null => {
  if (!isRecord(error)) {
    return null;
  }
  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (typeof error.status === "number") {
    return error.status;
  }
  return null;
};

const classifySyncError = (error: unknown): string => {
  if (error instanceof SyncLockRenewalError) {
    return "sync-lock-renewal-failed";
  }

  const statusCode = resolveErrorStatusCode(error);
  if (statusCode === 401 || statusCode === 403) {
    return "provider-auth-failed";
  }
  if (statusCode === 409 || statusCode === 412) {
    return "sync-push-conflict";
  }
  if (statusCode === 429) {
    return "provider-rate-limited";
  }
  if (statusCode !== null && statusCode >= 500) {
    return "provider-api-error";
  }

  const message = resolveErrorMessage(error).toLowerCase();
  let errorType = "";
  if (error instanceof Error) {
    errorType = error.name;
  } else if (isRecord(error) && typeof error.errorType === "string") {
    ({ errorType } = error);
  }
  if (message.includes("conflict") || message.includes("409") || message.includes("412")) {
    return "sync-push-conflict";
  }
  if (errorType.includes("Timeout") || message.includes("timeout") || message.includes("timed out")) {
    return "provider-api-timeout";
  }
  if (message.includes("rate") || message.includes("429")) {
    return "provider-rate-limited";
  }
  return "sync-push-failed";
};

const recordOperationFailures = (syncEvent: Record<string, unknown>): void => {
  const operationErrors = syncEvent.operation_errors;
  if (!Array.isArray(operationErrors)) {
    return;
  }

  let samples = 0;
  for (const operationError of operationErrors) {
    widelog.error("sync.failures", operationError);
    if (!isRecord(operationError)) {
      continue;
    }

    if (typeof operationError.type === "string") {
      widelog.append("sync.failure_operations", operationError.type);
    }
    if (typeof operationError.errorType === "string") {
      widelog.append("sync.failure_error_types", operationError.errorType);
    }
    if (typeof operationError.statusCode === "number") {
      widelog.append("sync.failure_status_codes", operationError.statusCode);
    }
    if (samples < 3 && typeof operationError.error === "string") {
      let operation = "unknown";
      if (typeof operationError.type === "string") {
        operation = operationError.type;
      }
      widelog.append("sync.error_samples", `[${operation}] ${operationError.error}`.slice(0, 500));
      samples += 1;
    }
  }
};

const applySyncEventFields = (syncEvent: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(syncEvent)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      widelog.set(key, value);
    }
  }
  recordOperationFailures(syncEvent);
};

const broadcastService = createBroadcastService({ redis: refreshLockRedis });

const persistSyncStatus = async (result: DestinationSyncResult, syncedAt: Date): Promise<void> => {
  await database
    .insert(syncStatusTable)
    .values({
      calendarId: result.calendarId,
      lastSyncedAt: syncedAt,
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
    })
    .onConflictDoUpdate({
      set: {
        lastSyncedAt: syncedAt,
        localEventCount: result.localEventCount,
        remoteEventCount: result.remoteEventCount,
      },
      target: [syncStatusTable.calendarId],
    });
};

const reportAggregateError = (scope: string, error: Error): void => {
  widelog.set("operation.name", "sync-aggregate");
  widelog.set("operation.type", "internal");
  widelog.set("sync_aggregate.scope", scope);
  widelog.set("outcome", "error");
  widelog.error(`sync_aggregate.${scope}`, error);
  widelog.errorFields(error, {
    prefix: "sync_aggregate.error",
    slug: classifySyncError(error),
  });
  widelog.flush();
};

const syncAggregateRuntime = createSyncAggregateRuntime({
  broadcast: (broadcastUserId, eventName, payload) => {
    broadcastService.emit(broadcastUserId, eventName, payload);
  },
  onError: reportAggregateError,
  persistSyncStatus,
  redis: refreshLockRedis,
});

const resolveSyncOutcome = (failed: number, total: number): "success" | "partial" | "error" => {
  if (total === 0) {
    return "success";
  }
  if (failed === total) {
    return "error";
  }
  if (failed > 0) {
    return "partial";
  }
  return "success";
};

const processJob = (
  job: Job<PushSyncJobPayload, PushSyncJobResult>,
  _token: string | undefined,
  signal: AbortSignal | undefined,
): Promise<PushSyncJobResult> =>
  context(async () => {
    const { userId } = job.data;

    widelog.set("operation.name", "push-sync").sticky();
    widelog.set("operation.type", "job").sticky();
    widelog.set("sync.direction", "push").sticky();
    widelog.set("user.id", userId).sticky();
    widelog.set("user.plan", job.data.plan).sticky();
    widelog.set("job.id", job.id ?? "").sticky();
    widelog.set("job.name", job.name).sticky();
    widelog.set("correlation.id", job.data.correlationId).sticky();

    widelog.errors(classifySyncError);

    const deadlineMs = Date.now() + USER_TIMEOUT_MS;

    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), USER_TIMEOUT_MS);
    let needsFlush = true;
    const pendingDestinationSyncs: Promise<void>[] = [];

    try {
      const abortSignal = mergeAbortSignals(deadlineController.signal, signal);
      const result = await syncDestinationsForUser(userId, {
        database,
        redis: refreshLockRedis,
        refreshLockStore,
        deadlineMs,
        abortSignal,
        encryptionKey: env.ENCRYPTION_KEY,
        oauthConfig: {
          googleClientId: env.GOOGLE_CLIENT_ID,
          googleClientSecret: env.GOOGLE_CLIENT_SECRET,
          microsoftClientId: env.MICROSOFT_CLIENT_ID,
          microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
        },
      }, {
        onProgress: (update) => {
          syncAggregateRuntime.onSyncProgress(update);
          job.updateProgress({
            calendarId: update.calendarId,
            stage: update.stage,
            progress: update.progress,
          });
        },
        onSyncEvent: (syncEvent) => {
          applySyncEventFields(syncEvent);
          needsFlush = true;

          const calendarId = syncEvent["calendar.id"];
          const localCount = syncEvent["local_events.count"];
          const remoteCount = syncEvent["remote_events.count"];
          const addFailed = resolveCount(syncEvent["events.add_failed"]);
          const removeFailed = resolveCount(syncEvent["events.remove_failed"]);
          const completedOutcome = syncEvent["outcome"] === "success"
            || syncEvent["outcome"] === "in-sync";

          if (typeof calendarId !== "string") {
            return;
          }

          pendingDestinationSyncs.push(
            syncAggregateRuntime
              .onDestinationSync({
                userId,
                calendarId,
                completedSuccessfully: completedOutcome && addFailed === 0 && removeFailed === 0,
                localEventCount: resolveCount(localCount),
                remoteEventCount: resolveCount(remoteCount),
              })
              .catch((error: unknown) => {
                reportAggregateError("destination-sync", toError(error));
              }),
          );
        },
        onCalendarComplete: (completion) => {
          widelog.set("provider.name", completion.provider);
          widelog.set("provider.account_id", completion.accountId);
          widelog.set("provider.calendar_id", completion.calendarId);
          widelog.set("sync.events_added", completion.added);
          widelog.set("sync.events_removed", completion.removed);
          widelog.set("sync.events_failed", completion.addFailed + completion.removeFailed);
          widelog.set("sync.conflicts_resolved", completion.conflictsResolved);
          widelog.set("duration_ms", completion.durationMs);

          if (!completion.syncEvent) {
            for (const syncError of completion.errors) {
              widelog.error("sync.failures", syncError);
            }
          }

          const totalFailed = completion.addFailed + completion.removeFailed;
          const totalAttempted = completion.added + completion.removed + totalFailed;
          const syncOutcome = completion.syncEvent?.outcome;
          let outcome = "success";
          if (totalFailed > 0) {
            outcome = resolveSyncOutcome(totalFailed, totalAttempted);
          } else if (typeof syncOutcome === "string") {
            outcome = syncOutcome;
          }
          widelog.set("outcome", outcome);
          widelog.flush();
          needsFlush = false;
        },
        onCalendarError: (failure) => {
          widelog.set("provider.name", failure.provider);
          widelog.set("provider.account_id", failure.accountId);
          widelog.set("provider.calendar_id", failure.calendarId);
          widelog.set("duration_ms", failure.durationMs);
          widelog.set("retry.backoff_applied", true);
          widelog.set("outcome", "error");
          widelog.errorFields(failure.error, { slug: classifySyncError(failure.error) });
          widelog.flush();
          needsFlush = false;
        },
      });

      if (result.syncEvents.length === 0) {
        widelog.set("outcome", "success");
        needsFlush = true;
      }

      return {
        added: result.added,
        addFailed: result.addFailed,
        removed: result.removed,
        removeFailed: result.removeFailed,
        errors: result.errors,
      };
    } catch (error) {
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: classifySyncError(error) });
      needsFlush = true;
      throw error;
    } finally {
      await Promise.all(pendingDestinationSyncs);
      clearTimeout(deadlineTimer);
      if (deadlineController.signal.aborted) {
        widelog.set("timeout.fired", true);
        widelog.set("timeout.kind", "job_deadline");
        widelog.set("timeout.limit_ms", USER_TIMEOUT_MS);
        widelog.set("error.slug", "sync-deadline-exceeded");
        needsFlush = true;
      }
      if (needsFlush) {
        widelog.flush();
      }
    }
  });

export { processJob, syncAggregateRuntime };
