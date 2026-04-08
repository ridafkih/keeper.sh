import type { Job } from "bullmq";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";
import type { DestinationSyncResult } from "@keeper.sh/calendar";
import { createSyncAggregateRuntime } from "@keeper.sh/calendar";
import { syncDestinationsForUser } from "@keeper.sh/sync";
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

const classifySyncError = (error: unknown): string => {
  if (typeof error === "string") {
    if (error.includes("conflict") || error.includes("409")) {
      return "sync-push-conflict";
    }
    if (error.includes("timeout")) {
      return "provider-api-timeout";
    }
    if (error.includes("rate") || error.includes("429")) {
      return "provider-rate-limited";
    }
  }
  return "sync-push-failed";
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

    try {
      const result = await syncDestinationsForUser(userId, {
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
          widelog.set("provider.name", completion.provider);
          widelog.set("provider.account_id", completion.accountId);
          widelog.set("provider.calendar_id", completion.calendarId);
          widelog.set("sync.events_added", completion.added);
          widelog.set("sync.events_removed", completion.removed);
          widelog.set("sync.events_failed", completion.addFailed + completion.removeFailed);
          widelog.set("sync.conflicts_resolved", completion.conflictsResolved);
          widelog.set("duration_ms", completion.durationMs);

          for (const syncError of completion.errors) {
            widelog.error("sync.failures", syncError);
          }

          const unclassifiedErrors = completion.errors
            .filter((syncError) => classifySyncError(syncError) === "sync-push-failed")
            .slice(0, 3);

          for (const sample of unclassifiedErrors) {
            widelog.append("sync.error_samples", sample.slice(0, 200));
          }

          const totalFailed = completion.addFailed + completion.removeFailed;
          const totalAttempted = completion.added + completion.removed + totalFailed;
          widelog.set("outcome", resolveSyncOutcome(totalFailed, totalAttempted));
          widelog.flush();
        },
      });

      return {
        added: result.added,
        addFailed: result.addFailed,
        removed: result.removed,
        removeFailed: result.removeFailed,
        errors: result.errors,
      };
    } catch (error) {
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: "push-sync-failed" });
      throw error;
    } finally {
      widelog.flush();
    }
  });

export { processJob, syncAggregateRuntime };
