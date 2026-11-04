import { recordUserMilestone } from "@keeper.sh/database";
import type { UserMilestoneDatabase } from "@keeper.sh/database";
import { context, widelog } from "./logging";

const createEventsCopiedMilestone = (database: UserMilestoneDatabase) => {
  const reachedUserIds = new Set<string>();

  return (userId: string): Promise<void> => {
    if (reachedUserIds.has(userId)) {
      return Promise.resolve();
    }

    return context(async () => {
      widelog.set("operation.name", "user.first_events_copied");
      widelog.set("operation.type", "lifecycle");
      widelog.set("user.id", userId);

      try {
        const reachedNow = await recordUserMilestone(database, userId, "first_events_copied");
        reachedUserIds.add(userId);
        if (!reachedNow) {
          return;
        }
        widelog.set("outcome", "success");
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error, { slug: "milestone-record-failed" });
      }
      widelog.flush();
    });
  };
};

export { createEventsCopiedMilestone };
