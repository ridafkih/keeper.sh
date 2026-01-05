import type { SyncResult } from "../types";
import type { SyncContext, SyncCoordinator } from "./coordinator";

const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;

interface DestinationProvider {
  syncForUser(userId: string, context: SyncContext): Promise<SyncResult | null>;
}

const syncDestinationsForUser = async (
  userId: string,
  providers: DestinationProvider[],
  syncCoordinator: SyncCoordinator,
): Promise<SyncResult> => {
  const context = await syncCoordinator.startSync(userId);

  const settledResults = await Promise.allSettled(
    providers.map((provider) => provider.syncForUser(userId, context)),
  );

  await syncCoordinator.isSyncCurrent(context);

  const combined: SyncResult = {
    addFailed: INITIAL_ADD_FAILED_COUNT,
    added: INITIAL_ADDED_COUNT,
    removeFailed: INITIAL_REMOVE_FAILED_COUNT,
    removed: INITIAL_REMOVED_COUNT,
  };

  for (const settled of settledResults) {
    if (settled.status !== "fulfilled" || settled.value === null) {
      continue;
    }
    combined.added += settled.value.added;
    combined.addFailed += settled.value.addFailed;
    combined.removed += settled.value.removed;
    combined.removeFailed += settled.value.removeFailed;
  }

  return combined;
};

export { syncDestinationsForUser };
export type { DestinationProvider };
