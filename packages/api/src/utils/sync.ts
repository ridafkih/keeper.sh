import { syncDestinationsForUser } from "@keeper.sh/integrations";
import { destinationProviders, syncCoordinator } from "../context";

export const triggerDestinationSync = (userId: string): void => {
  syncDestinationsForUser(userId, destinationProviders, syncCoordinator).catch(
    () => {},
  );
};
