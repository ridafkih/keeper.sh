import type { Job } from "bullmq";
import type { PushSyncJobPayload, PushSyncJobResult } from "@keeper.sh/queue";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";
import type { DestinationSyncResult } from "@keeper.sh/calendar";
import { createSyncAggregateRuntime } from "@keeper.sh/calendar";
import { syncDestinationsForUser } from "@keeper.sh/sync";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { database, refreshLockRedis } from "./context";
import { widelog } from "./utils/logging";
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

const processJob = async (job: Job<PushSyncJobPayload, PushSyncJobResult>): Promise<PushSyncJobResult> => {
  const { userId, plan } = job.data;
  const deadlineMs = Date.now() + USER_TIMEOUT_MS;

  widelog.setFields({
    "job.id": job.id,
    "job.type": "push-sync",
    "user.id": userId,
    "subscription.plan": plan,
  });

  const result = await syncDestinationsForUser(userId, {
    database,
    redis: refreshLockRedis,
    deadlineMs,
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
  });

  widelog.setFields({
    "events.added": result.added,
    "events.add_failed": result.addFailed,
    "events.removed": result.removed,
    "events.remove_failed": result.removeFailed,
  });

  for (const error of result.errors) {
    widelog.append("events.errors", error);
  }

  widelog.set("outcome", "success");
  widelog.set("status_code", 200);

  return {
    added: result.added,
    addFailed: result.addFailed,
    removed: result.removed,
    removeFailed: result.removeFailed,
    errors: result.errors,
  };
};

export { processJob };
