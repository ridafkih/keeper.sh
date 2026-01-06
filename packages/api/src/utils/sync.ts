import { syncDestinationsForUser } from "@keeper.sh/provider-core";
import { destinationProviders, syncCoordinator } from "../context";
import { executeBackgroundTask } from "./background-task";

const triggerDestinationSync = (userId: string): void => {
  executeBackgroundTask("destination-sync", { userId }, async () => {
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
