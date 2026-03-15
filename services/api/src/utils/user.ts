import { user as userTable } from "@keeper.sh/database";
import { eq } from "drizzle-orm";
import { database } from "../context";

const FIRST_RESULT_LIMIT = 1;

const resolveUserIdentifier = async (identifier: string): Promise<string | null> => {
  const [userByUsername] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, identifier))
    .limit(FIRST_RESULT_LIMIT);

  if (userByUsername) {
    return userByUsername.id;
  }

  const [userById] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, identifier))
    .limit(FIRST_RESULT_LIMIT);

  return userById?.id ?? null;
};

const getUserIdentifierToken = async (userId: string): Promise<string> => {
  const [userData] = await database
    .select({ username: userTable.username })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(FIRST_RESULT_LIMIT);

  return userData?.username ?? userId;
};

export { resolveUserIdentifier, getUserIdentifierToken };
