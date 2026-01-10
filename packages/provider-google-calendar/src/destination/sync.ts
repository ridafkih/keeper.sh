import {
  getOAuthAccountsByPlan,
  getOAuthAccountsForUser,
  getUserEventsForSync,
} from "@keeper.sh/provider-core";
import type { OAuthAccount, SyncableEvent } from "@keeper.sh/provider-core";
import type { Plan } from "@keeper.sh/premium";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const PROVIDER = "google";

type GoogleAccount = OAuthAccount;

const getGoogleAccountsByPlan = (
  database: PostgresJsDatabase,
  targetPlan: Plan,
): Promise<GoogleAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

const getGoogleAccountsForUser = (
  database: PostgresJsDatabase,
  userId: string,
): Promise<GoogleAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

const getUserEvents = (database: PostgresJsDatabase, userId: string): Promise<SyncableEvent[]> =>
  getUserEventsForSync(database, userId);

export { getGoogleAccountsByPlan, getGoogleAccountsForUser, getUserEvents };
export type { GoogleAccount };
