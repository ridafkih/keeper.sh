import type { SyncResult } from "./types";
import { log } from "@keeper.sh/log";
import type { SyncContext, SyncCoordinator } from "./sync-coordinator";

export interface DestinationProvider {
  syncForUser(userId: string, context: SyncContext): Promise<SyncResult | null>;
}

export async function syncDestinationsForUser(
  userId: string,
  providers: DestinationProvider[],
  syncCoordinator: SyncCoordinator,
): Promise<void> {
  const context = await syncCoordinator.startSync(userId);

  if (!context.acquired) {
    return;
  }

  try {
    const results = await Promise.allSettled(
      providers.map((provider) => provider.syncForUser(userId, context)),
    );

    const isCurrent = await syncCoordinator.isSyncCurrent(context);

    for (const result of results) {
      if (result.status === "rejected" && isCurrent) {
        log.error(
          { err: result.reason },
          "destination sync failed for user '%s'",
          userId,
        );
      }
    }
  } finally {
    await syncCoordinator.endSync(context);
  }
}
