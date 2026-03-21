import type { Job } from "bullmq";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";
import { RuntimeInvariantViolationError } from "@keeper.sh/machine-orchestration";
import { runKeeperSyncRuntimeForUser } from "@keeper.sh/machine-orchestration";
import type { DestinationSyncResult } from "@keeper.sh/calendar";
import { createSyncAggregateRuntime } from "@keeper.sh/calendar";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { database, refreshLockRedis, refreshLockStore } from "./context";
import { context, widelog } from "./utils/logging";
import { createPerCalendarMachineFieldCollector } from "./utils/per-calendar-machine-fields";
import { classifySyncError } from "./utils/sync-error-classification";
import { emitWideEvent } from "./utils/emit-wide-event";
import env from "./env";

const resolveCount = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  return 0;
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

const syncAggregateRuntime = createSyncAggregateRuntime({
  broadcast: (broadcastUserId, eventName, payload) => {
    broadcastService.emit(broadcastUserId, eventName, payload);
  },
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

const resolveRequiredJobId = (
  job: Job<PushSyncJobPayload, PushSyncJobResult>,
  userId: string,
): string => {
  if (job.id === globalThis.undefined) {
    throw new RuntimeInvariantViolationError({
      aggregateId: userId,
      code: "WORKER_JOB_ID_REQUIRED",
      reason: "worker job id missing",
      surface: "worker-processor",
    });
  }
  return String(job.id);
};

const setJobWideEventFields = (
  job: Job<PushSyncJobPayload, PushSyncJobResult>,
  jobId: string,
  userId: string,
): void => {
  widelog.set("operation.name", "push-sync");
  widelog.set("operation.type", "job").sticky();
  widelog.set("sync.direction", "push").sticky();
  widelog.set("user.id", userId).sticky();
  widelog.set("user.plan", job.data.plan).sticky();
  widelog.set("job.id", jobId).sticky();
  widelog.set("job.name", job.name).sticky();
  widelog.set("correlation.id", job.data.correlationId).sticky();
};

const processJob = (
  job: Job<PushSyncJobPayload, PushSyncJobResult>,
  _token: string | undefined,
  signal: AbortSignal | undefined,
): Promise<PushSyncJobResult> =>
  context(async () => {
    const { userId } = job.data;
    const jobId = resolveRequiredJobId(job, userId);

    setJobWideEventFields(job, jobId, userId);
    widelog.errors(classifySyncError);
    const machineFieldCollector = createPerCalendarMachineFieldCollector();
    const emitCalendarWideEvent = async (
      input: {
        provider: string;
        accountId: string;
        calendarId: string;
        durationMs: number;
        added: number;
        removed: number;
        failed: number;
        errors: string[];
        outcome: "success" | "partial" | "error";
      },
    ): Promise<void> => {
      await emitWideEvent(() => {
        setJobWideEventFields(job, jobId, userId);
        widelog.set("operation.name", "push-sync-calendar");
        widelog.set("provider.name", input.provider);
        widelog.set("provider.account_id", input.accountId);
        widelog.set("provider.calendar_id", input.calendarId);
        widelog.set("calendar_sync.id", `${jobId}:${input.calendarId}`);
        widelog.set("sync.events_added", input.added);
        widelog.set("sync.events_removed", input.removed);
        widelog.set("sync.events_failed", input.failed);
        widelog.set("duration_ms", input.durationMs);
        const machineFields = machineFieldCollector.consumeCalendarFields(input.calendarId);
        for (const [field, value] of machineFields.entries()) {
          widelog.set(field, value);
        }
        for (const syncError of input.errors) {
          widelog.error("sync.failures", syncError);
        }
        widelog.set("outcome", input.outcome);
      });
    };

    const deadlineMs = Date.now() + USER_TIMEOUT_MS;

    try {
      const result = await runKeeperSyncRuntimeForUser(userId, {
        database,
        redis: refreshLockRedis,
        refreshLockStore,
        deadlineMs,
        abortSignal: signal,
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
          const calendarId = syncEvent["calendar.id"];
          const localCount = syncEvent["local_events.count"];
          const remoteCount = syncEvent["remote_events.count"];

          if (typeof calendarId !== "string") {
            return;
          }

          syncAggregateRuntime.onDestinationSync({
            userId,
            calendarId,
            localEventCount: resolveCount(localCount),
            remoteEventCount: resolveCount(remoteCount),
          });
        },
        onCalendarComplete: (completion) => {
          const totalFailed = completion.addFailed + completion.removeFailed;
          const totalAttempted = completion.added + completion.removed + totalFailed;
          return emitCalendarWideEvent({
            provider: completion.provider,
            accountId: completion.accountId,
            calendarId: completion.calendarId,
            durationMs: completion.durationMs,
            added: completion.added,
            removed: completion.removed,
            failed: totalFailed,
            errors: completion.errors,
            outcome: resolveSyncOutcome(totalFailed, totalAttempted),
          });
        },
        onCalendarFailed: (failure) =>
          emitCalendarWideEvent({
            provider: failure.provider,
            accountId: failure.accountId,
            calendarId: failure.calendarId,
            durationMs: failure.durationMs,
            added: 0,
            removed: 0,
            failed: 1,
            errors: [failure.error],
            outcome: "error",
          }),
        onCredentialRuntimeEvent: (calendarId, event) => {
          machineFieldCollector.pushEvent("credential_health", calendarId, event);
        },
        onDestinationRuntimeEvent: (calendarId, event) => {
          machineFieldCollector.pushEvent("destination_execution", calendarId, event);
        },
      });

      const failed = result.addFailed + result.removeFailed;
      const attempted = result.added + result.removed + failed;
      await emitWideEvent(() => {
        setJobWideEventFields(job, jobId, userId);
        widelog.set("sync.events_added", result.added);
        widelog.set("sync.events_removed", result.removed);
        widelog.set("sync.events_failed", failed);
        widelog.set("outcome", resolveSyncOutcome(failed, attempted));
      });

      return {
        added: result.added,
        addFailed: result.addFailed,
        removed: result.removed,
        removeFailed: result.removeFailed,
        errors: result.errors,
      };
    } catch (error) {
      await emitWideEvent(() => {
        setJobWideEventFields(job, jobId, userId);
        widelog.set("outcome", "error");
        widelog.errorFields(error, { slug: "push-sync-failed" });
      });
      throw error;
    }
  });

export { processJob, syncAggregateRuntime };
