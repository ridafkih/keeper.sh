import { syncDestinationsForUser } from "@keeper.sh/integration";
import { getWideEvent } from "@keeper.sh/log";
import { destinationProviders, syncCoordinator } from "../context";

export const triggerDestinationSync = (userId: string): void => {
  syncDestinationsForUser(userId, destinationProviders, syncCoordinator).catch(
    (error) => {
      getWideEvent()?.setError(error);
    },
  );
};
