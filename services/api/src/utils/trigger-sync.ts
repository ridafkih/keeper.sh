import type { Plan } from "@keeper.sh/data-schemas";
import { wakeUserIngests } from "@keeper.sh/database";
import type { KeeperSyncTriggerResult } from "@/types";
import { enqueuePushSync } from "./enqueue-push-sync";

interface TriggerSyncDependencies {
  enqueuePushSync: (userId: string, plan: Plan) => Promise<void>;
  wakeSources: (userId: string) => Promise<number>;
}

const runTriggerSync = async (
  userId: string,
  plan: Plan,
  dependencies: TriggerSyncDependencies,
): Promise<KeeperSyncTriggerResult> => {
  const sourcesRefreshed = await dependencies.wakeSources(userId);
  await dependencies.enqueuePushSync(userId, plan);

  return { sourcesRefreshed, triggered: true };
};

const triggerSync = async (userId: string, plan: Plan): Promise<KeeperSyncTriggerResult> => {
  const { database } = await import("@/context");

  return runTriggerSync(userId, plan, {
    enqueuePushSync,
    wakeSources: async (wakeUserId) => {
      const woken = await wakeUserIngests(database, wakeUserId, {
        correlationId: null,
        debounceMs: 0,
      });
      return woken.length;
    },
  });
};

export { runTriggerSync, triggerSync };
export type { TriggerSyncDependencies };
