import type { Plan } from "@keeper.sh/data-schemas";
import { calendarsTable } from "@keeper.sh/database/schema";
import { and, eq, isNotNull, or } from "drizzle-orm";
import type { KeeperSyncTriggerResult } from "@/types";
import { RECONNECTED_BACKOFF_STATE } from "./calendar-state";
import { enqueuePushSync } from "./enqueue-push-sync";

interface TriggerSyncDependencies {
  clearIngestBackoff: (userId: string) => Promise<number>;
  enqueuePushSync: (userId: string, plan: Plan) => Promise<void>;
}

const runTriggerSync = async (
  userId: string,
  plan: Plan,
  dependencies: TriggerSyncDependencies,
): Promise<KeeperSyncTriggerResult> => {
  const sourcesRefreshed = await dependencies.clearIngestBackoff(userId);
  await dependencies.enqueuePushSync(userId, plan);

  return { sourcesRefreshed, triggered: true };
};

const triggerSync = async (userId: string, plan: Plan): Promise<KeeperSyncTriggerResult> => {
  const { database } = await import("@/context");

  return runTriggerSync(userId, plan, {
    clearIngestBackoff: async (backoffUserId) => {
      const cleared = await database
        .update(calendarsTable)
        .set(RECONNECTED_BACKOFF_STATE)
        .where(and(
          eq(calendarsTable.userId, backoffUserId),
          eq(calendarsTable.disabled, false),
          or(
            isNotNull(calendarsTable.ingestNextAttemptAt),
            isNotNull(calendarsTable.nextAttemptAt),
          ),
        ))
        .returning({ id: calendarsTable.id });

      return cleared.length;
    },
    enqueuePushSync,
  });
};

export { runTriggerSync, triggerSync };
export type { TriggerSyncDependencies };
