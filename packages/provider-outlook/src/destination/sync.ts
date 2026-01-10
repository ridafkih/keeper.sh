import {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  getUserEventsForSync,
} from "@keeper.sh/provider-core";
import type { OAuthAccount, SyncableEvent } from "@keeper.sh/provider-core";
import type { Plan } from "@keeper.sh/premium";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const PROVIDER = "outlook";

type OutlookAccount = OAuthAccount;

const getOutlookAccountsByPlan = (
  database: PostgresJsDatabase,
  targetPlan: Plan,
): Promise<OutlookAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

const getOutlookAccountsForUser = (
  database: PostgresJsDatabase,
  userId: string,
): Promise<OutlookAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

const getUserEvents = (database: PostgresJsDatabase, userId: string): Promise<SyncableEvent[]> =>
  getUserEventsForSync(database, userId);

export { getOutlookAccountsByPlan, getOutlookAccountsForUser, getUserEvents };
export type { OutlookAccount };
