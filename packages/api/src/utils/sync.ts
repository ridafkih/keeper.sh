import { syncDestinationsForUser } from "@keeper.sh/integration";
import { destinationProviders, syncCoordinator } from "../context";

export const triggerDestinationSync = (userId: string): void => {
  syncDestinationsForUser(userId, destinationProviders, syncCoordinator).catch(
    () => {},
  );
};
