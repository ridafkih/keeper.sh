import {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  getUserEventsForSync,
  type OAuthAccount,
  type SyncableEvent,
} from "@keeper.sh/integration";
import type { Plan } from "@keeper.sh/premium";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const PROVIDER = "outlook";

export type OutlookAccount = OAuthAccount;

export const getOutlookAccountsByPlan = (
  database: BunSQLDatabase,
  targetPlan: Plan,
): Promise<OutlookAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

export const getOutlookAccountsForUser = (
  database: BunSQLDatabase,
  userId: string,
): Promise<OutlookAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

export const getUserEvents = (
  database: BunSQLDatabase,
  userId: string,
): Promise<SyncableEvent[]> => getUserEventsForSync(database, userId);
