import {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  getUserEventsForSync,
} from "../../core";
import type { OAuthAccount, SyncableEvent } from "../../core";
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

const getUserEvents = (database: BunSQLDatabase, userId: string): Promise<SyncableEvent[]> =>
  getUserEventsForSync(database, userId);

export { getOutlookAccountsByPlan, getOutlookAccountsForUser, getUserEvents };
export type { OutlookAccount };
