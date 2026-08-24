import { getOAuthAccountsByPlan, getOAuthAccountsForUser } from "../../../core/oauth/accounts";
import type { OAuthAccount } from "../../../core/oauth/accounts";
import type { Plan } from "@keeper.sh/data-schemas";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const PROVIDER = "outlook";

type OutlookAccount = OAuthAccount;

const getOutlookAccountsByPlan = (
  database: BunSQLDatabase,
  targetPlan: Plan,
): Promise<OutlookAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

const getOutlookAccountsForUser = (
  database: BunSQLDatabase,
  userId: string,
): Promise<OutlookAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

export { getOutlookAccountsByPlan, getOutlookAccountsForUser };
export type { OutlookAccount };
