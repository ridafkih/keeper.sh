import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { user } from "./auth-schema";

type UserAgentFeedbackDatabase = Pick<BunSQLDatabase, "select">;

const USER_AGENT_FEEDBACK_READ = {
  columns: [user.id, user.agentFeedbackEnabled],
  table: user,
};

const readUserAgentFeedbackEnabled = async (
  database: UserAgentFeedbackDatabase,
  userId: string,
): Promise<boolean> => {
  const [row] = await database
    .select({ agentFeedbackEnabled: user.agentFeedbackEnabled })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) {
    throw new Error(`No user ${userId} to read the agent feedback preference of`);
  }
  return row.agentFeedbackEnabled;
};

export { readUserAgentFeedbackEnabled, USER_AGENT_FEEDBACK_READ };
export type { UserAgentFeedbackDatabase };
