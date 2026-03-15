import { syncDestinationsForUser } from "@keeper.sh/sync";
import type { SyncConfig, SyncDestinationsResult } from "@keeper.sh/sync";
import { spawnBackgroundJob } from "./background-task";
import { widelog } from "./logging";

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

const triggerDestinationSync = (userId: string): void => {
  const correlationId = crypto.randomUUID();

  widelog.set("destination_sync.correlation_id", correlationId);
  widelog.set("destination_sync.triggered", true);

  spawnBackgroundJob("destination-sync", { "user.id": userId, "correlation.id": correlationId }, async () => {
    const syncConfig = await buildSyncConfig();
    const result = await syncDestinationsForUser(userId, syncConfig);
    return mapDestinationSyncResult(result);
  });
};

export { triggerDestinationSync };
