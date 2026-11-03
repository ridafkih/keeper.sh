import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { userMilestonesTable } from "./schema";
import type { UserMilestone } from "./schema";

type UserMilestoneDatabase = Pick<BunSQLDatabase, "insert">;

const recordUserMilestone = async (
  database: UserMilestoneDatabase,
  userId: string,
  milestone: UserMilestone,
): Promise<boolean> => {
  const inserted = await database
    .insert(userMilestonesTable)
    .values({ milestone, userId })
    .onConflictDoNothing({ target: [userMilestonesTable.userId, userMilestonesTable.milestone] })
    .returning({ id: userMilestonesTable.id });

  return inserted.length > 0;
};

export { recordUserMilestone };
export type { UserMilestoneDatabase };
