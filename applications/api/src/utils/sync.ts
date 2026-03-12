import { syncDestinationsForUser } from "@keeper.sh/provider-core";
import { spawnBackgroundJob } from "./background-task";
import { runApiWideEventContext, setWideEventFields, widelog } from "./logging";

type DestinationSyncResult = Awaited<ReturnType<typeof syncDestinationsForUser>>;

interface DestinationSyncDependencies {
  spawnBackgroundJob: (
    jobName: string,
    fields: Record<string, unknown>,
    callback: () => Promise<Record<string, number>>,
  ) => void;
  syncDestinationsForUser: (userId: string) => Promise<DestinationSyncResult>;
}

const mapDestinationSyncResult = (result: DestinationSyncResult): Record<string, number> => ({
  eventsAdded: result.added,
  eventsAddFailed: result.addFailed,
  eventsRemoved: result.removed,
  eventsRemoveFailed: result.removeFailed,
});

const runDestinationSyncTrigger = (
  userId: string,
  dependencies: DestinationSyncDependencies,
): void => {
  dependencies.spawnBackgroundJob("destination-sync", { userId }, async () => {
    const result = await dependencies.syncDestinationsForUser(userId);
    return mapDestinationSyncResult(result);
  });
};

const triggerDestinationSync = (userId: string): void => {
  const resolveDependencies = async (): Promise<DestinationSyncDependencies> => {
    const { destinationProviders, syncCoordinator } = await import("../context");
    return {
      spawnBackgroundJob,
      syncDestinationsForUser: (userIdToSync) =>
        syncDestinationsForUser(userIdToSync, destinationProviders, syncCoordinator),
    };
  };

  const startSync = async (): Promise<void> => {
    const dependencies = await resolveDependencies();
    runDestinationSyncTrigger(userId, dependencies);
  };

  startSync().catch((error) => {
    runApiWideEventContext(() => {
      setWideEventFields({
        duration_ms: 0,
        operation: {
          name: "destination-sync:trigger",
          type: "background-job",
        },
        request: {
          id: crypto.randomUUID(),
        },
        user: {
          id: userId,
        },
      });
      widelog.set("outcome", "error");
      widelog.set("status_code", 500);
      widelog.errorFields(error);
      widelog.flush();
    });
  });
};

export { triggerDestinationSync, runDestinationSyncTrigger };
