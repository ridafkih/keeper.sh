import { user as userTable } from "@keeper.sh/database";
import { eq } from "drizzle-orm";
import { database } from "../context";

/**
 * Resolves a user identifier (username or userId) to a userId.
 * Tries username first, then falls back to userId.
 * Returns null if no user is found.
 */
export const resolveUserIdentifier = async (identifier: string): Promise<string | null> => {
  const [userByUsername] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, identifier))
    .limit(1);

  if (userByUsername) {
    return userByUsername.id;
  }

  const [userById] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, identifier))
    .limit(1);

  return userById?.id ?? null;
};

/**
 * Gets the public identifier token for a user.
 * Returns username if set, otherwise returns userId.
 */
export const getUserIdentifierToken = async (userId: string): Promise<string> => {
  const [userData] = await database
    .select({ username: userTable.username })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return userData?.username ?? userId;
};
