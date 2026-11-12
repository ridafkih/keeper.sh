import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SignUpAttribution } from "@keeper.sh/data-schemas";
import { userSignUpAttributionsTable } from "./schema";

type UserSignUpAttributionDatabase = Pick<BunSQLDatabase, "insert">;

const recordUserSignUpAttribution = async (
  database: UserSignUpAttributionDatabase,
  userId: string,
  attribution: SignUpAttribution,
): Promise<void> => {
  await database
    .insert(userSignUpAttributionsTable)
    .values({ ...attribution, userId })
    .onConflictDoNothing({ target: userSignUpAttributionsTable.userId });
};

export { recordUserSignUpAttribution };
export type { UserSignUpAttributionDatabase };
