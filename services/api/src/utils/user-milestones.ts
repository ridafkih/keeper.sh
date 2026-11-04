import { recordUserMilestone } from "@keeper.sh/database";
import type { UserMilestone } from "@keeper.sh/database/schema";
import { context, widelog } from "./logging";
import { labelFailure } from "./error-labelling";

const noteUserMilestone = (userId: string, milestone: UserMilestone): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", `user.${milestone}`);
    widelog.set("operation.type", "lifecycle");
    widelog.set("user.id", userId);

    try {
      const { database } = await import("@/context");
      const reachedNow = await recordUserMilestone(database, userId, milestone);
      if (!reachedNow) {
        return;
      }
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("outcome", "error");
      labelFailure(error, { slug: "milestone-record-failed" });
    }
    widelog.flush();
  });

export { noteUserMilestone };
