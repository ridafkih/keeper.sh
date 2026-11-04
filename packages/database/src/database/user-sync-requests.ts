import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { userSyncRequestsTable } from "./schema";

type UserSyncRequestDatabase = Pick<BunSQLDatabase, "insert">;

const recordUserSyncRequest = async (
  database: UserSyncRequestDatabase,
  userId: string,
): Promise<void> => {
  const request = { requestId: crypto.randomUUID(), requestedAt: new Date() };
  await database
    .insert(userSyncRequestsTable)
    .values({ ...request, userId })
    .onConflictDoUpdate({ target: userSyncRequestsTable.userId, set: request });
};

export { recordUserSyncRequest };
export type { UserSyncRequestDatabase };
