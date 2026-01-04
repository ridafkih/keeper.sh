import {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  getUserEventsForSync,
  type OAuthAccount,
  type SyncableEvent,
} from "@keeper.sh/integration";
import type { Plan } from "@keeper.sh/premium";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const PROVIDER = "google";

export type GoogleAccount = OAuthAccount;

export const getGoogleAccountsByPlan = (
  database: BunSQLDatabase,
  targetPlan: Plan,
): Promise<GoogleAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

export const getGoogleAccountsForUser = (
  database: BunSQLDatabase,
  userId: string,
): Promise<GoogleAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

export const getUserEvents = (
  database: BunSQLDatabase,
  userId: string,
): Promise<SyncableEvent[]> => getUserEventsForSync(database, userId);
