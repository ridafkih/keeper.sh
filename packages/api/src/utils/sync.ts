import { syncDestinationsForUser } from "@keeper.sh/integration";
import { WideEvent, emitWideEvent, runWithWideEvent } from "@keeper.sh/log";
import { destinationProviders, syncCoordinator } from "../context";

const executeSyncWithWideEvent = async (userId: string): Promise<void> => {
  const event = new WideEvent("api");
  event.set({
    operationName: "destination-sync",
    operationType: "background",
    userId,
  });

  await runWithWideEvent(event, async () => {
    try {
      const result = await syncDestinationsForUser(userId, destinationProviders, syncCoordinator);
      event.set({
        eventsAdded: result.added,
        eventsAddFailed: result.addFailed,
        eventsRemoved: result.removed,
        eventsRemoveFailed: result.removeFailed,
      });
    } catch (error) {
      event.setError(error);
      throw error;
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

const triggerDestinationSync = (userId: string): void => {
  executeSyncWithWideEvent(userId).catch(() => null);
};

export { triggerDestinationSync };
