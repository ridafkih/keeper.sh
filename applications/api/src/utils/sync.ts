import { syncDestinationsForUser } from "@keeper.sh/provider-core";
import { destinationProviders, syncCoordinator } from "../context";
import { spawnBackgroundJob } from "./background-task";

const triggerDestinationSync = (userId: string): void => {
  spawnBackgroundJob("destination-sync", { userId }, async () => {
    const result = await syncDestinationsForUser(userId, destinationProviders, syncCoordinator);
    return {
      eventsAdded: result.added,
      eventsAddFailed: result.addFailed,
      eventsRemoved: result.removed,
      eventsRemoveFailed: result.removeFailed,
    };
  });
};

export { triggerDestinationSync };
