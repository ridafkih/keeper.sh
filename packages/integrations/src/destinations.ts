import type { SyncResult } from "./types";
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

  try {
    const results = await Promise.allSettled(
      providers.map((provider) => provider.syncForUser(userId, context)),
    );

    await syncCoordinator.isSyncCurrent(context);
  } finally {
    await syncCoordinator.endSync(context);
  }
}
