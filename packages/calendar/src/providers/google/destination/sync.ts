import { getOAuthAccountsByPlan, getOAuthAccountsForUser, getUserEventsForSync } from "../../../core/oauth/accounts";
import type { OAuthAccount } from "../../../core/oauth/accounts";
import type { SyncableEvent } from "../../../core/types";
import type { Plan } from "@keeper.sh/data-schemas";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const PROVIDER = "google";

type GoogleAccount = OAuthAccount;

const getGoogleAccountsByPlan = (
  database: BunSQLDatabase,
  targetPlan: Plan,
): Promise<GoogleAccount[]> => getOAuthAccountsByPlan(database, PROVIDER, targetPlan);

const getGoogleAccountsForUser = (
  database: BunSQLDatabase,
  userId: string,
): Promise<GoogleAccount[]> => getOAuthAccountsForUser(database, PROVIDER, userId);

const getUserEvents = (database: BunSQLDatabase, userId: string): Promise<SyncableEvent[]> =>
  getUserEventsForSync(database, userId);

export { getGoogleAccountsByPlan, getGoogleAccountsForUser, getUserEvents };
export type { GoogleAccount };
