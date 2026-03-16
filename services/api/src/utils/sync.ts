import { syncDestinationsForUser } from "@keeper.sh/sync";
import type { SyncConfig, SyncDestinationsResult } from "@keeper.sh/sync";
import { spawnBackgroundJob } from "./background-task";

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

const buildSyncConfig = async (): Promise<SyncConfig> => {
  const { database, redis, env } = await import("@/context");

  return {
    database,
    redis,
    encryptionKey: env.ENCRYPTION_KEY,
    oauthConfig: {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      microsoftClientId: env.MICROSOFT_CLIENT_ID,
      microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
    },
  };
};

const activeSyncAbortControllers = new Map<string, AbortController>();

const triggerDestinationSync = (userId: string): void => {
  const previousController = activeSyncAbortControllers.get(userId);
  if (previousController) {
    previousController.abort();
  }

  const abortController = new AbortController();
  activeSyncAbortControllers.set(userId, abortController);

  spawnBackgroundJob("destination-sync", { "user.id": userId }, async () => {
    const syncConfig = await buildSyncConfig();
    const { getSyncAggregateRuntime } = await import("@/context");
    const syncAggregateRuntime = getSyncAggregateRuntime();

    const result = await syncDestinationsForUser(userId, { ...syncConfig, abortSignal: abortController.signal }, {
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

    const currentController = activeSyncAbortControllers.get(userId);
    if (currentController === abortController) {
      activeSyncAbortControllers.delete(userId);
    }

    return mapDestinationSyncResult(result);
  });
};

export { triggerDestinationSync };
