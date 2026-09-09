import { user as userTable } from "@keeper.sh/database";
import { eq } from "drizzle-orm";
import { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

const resolveUserIdentifier = async (identifier: string): Promise<string | null> => {
  const [userById] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, identifier))
    .limit(FIRST_RESULT_LIMIT);

  if (userById) {
    return userById.id;
  }

  const [userByUsername] = await database
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, identifier))
    .limit(FIRST_RESULT_LIMIT);

  return userByUsername?.id ?? null;
};

export { resolveUserIdentifier };
