import { syncDestinationsForUser } from "@keeper.sh/sync";
import type { SyncConfig, SyncDestinationsResult } from "@keeper.sh/sync";
import type { SyncAggregateRuntime } from "@keeper.sh/calendar";
import { spawnBackgroundJob } from "./background-task";
import { widelog } from "./logging";

const resolveCount = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  return 0;
};

const mapDestinationSyncResult = (result: SyncDestinationsResult): Record<string, number> => ({
  eventsAdded: result.added,
  eventsAddFailed: result.addFailed,
  eventsRemoved: result.removed,
  eventsRemoveFailed: result.removeFailed,
});

interface SyncContext {
  syncConfig: SyncConfig;
  syncAggregateRuntime: SyncAggregateRuntime;
}

const buildSyncContext = async (): Promise<SyncContext> => {
  const { database, redis, env, syncAggregateRuntime } = await import("@/context");

  return {
    syncConfig: {
      database,
      redis,
      encryptionKey: env.ENCRYPTION_KEY,
      oauthConfig: {
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        microsoftClientId: env.MICROSOFT_CLIENT_ID,
        microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
      },
    },
    syncAggregateRuntime,
  };
};

const triggerDestinationSync = (userId: string): void => {
  const correlationId = crypto.randomUUID();

  widelog.set("destination_sync.correlation_id", correlationId);
  widelog.set("destination_sync.triggered", true);

  spawnBackgroundJob("destination-sync", { "user.id": userId, "correlation.id": correlationId }, async () => {
    const { syncConfig, syncAggregateRuntime } = await buildSyncContext();
    const result = await syncDestinationsForUser(userId, syncConfig, {
      onProgress: (update) => {
        syncAggregateRuntime.onSyncProgress(update);
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
    return mapDestinationSyncResult(result);
  });
};

export { triggerDestinationSync };
