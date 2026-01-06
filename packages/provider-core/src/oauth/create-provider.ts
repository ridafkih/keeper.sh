import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthTokenProvider } from "./provider";
import type { DestinationProvider } from "../sync/destinations";
import type { BroadcastSyncStatus, OAuthProviderConfig, SyncResult, SyncableEvent } from "../types";
import type { SyncContext } from "../sync/coordinator";
import { getEventsForDestination } from "../events/events";
import type { OAuthCalendarProvider } from "./provider";
import type { OAuthAccount } from "./accounts";

const EMPTY_ACCOUNTS_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;

interface CreateOAuthProviderOptions<
  TAccount extends OAuthAccount,
  TConfig extends OAuthProviderConfig,
> {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  getAccountsForUser: (database: BunSQLDatabase, userId: string) => Promise<TAccount[]>;
  createProviderInstance: (
    config: TConfig,
    oauthProvider: OAuthTokenProvider,
  ) => OAuthCalendarProvider<TConfig>;
  buildConfig: (
    database: BunSQLDatabase,
    account: TAccount,
    broadcastSyncStatus?: BroadcastSyncStatus,
  ) => TConfig;
}

const createOAuthDestinationProvider = <
  TAccount extends OAuthAccount,
  TConfig extends OAuthProviderConfig,
>(
  options: CreateOAuthProviderOptions<TAccount, TConfig>,
): DestinationProvider => {
  const {
    database,
    oauthProvider,
    broadcastSyncStatus,
    getAccountsForUser,
    createProviderInstance,
    buildConfig,
  } = options;

  const syncForUser = async (userId: string, context: SyncContext): Promise<SyncResult | null> => {
    const accounts = await getAccountsForUser(database, userId);
    if (accounts.length === EMPTY_ACCOUNTS_COUNT) {
      return null;
    }

    const results = await Promise.all(
      accounts.map(async (account) => {
        const localEvents = await getEventsForDestination(database, account.destinationId);

        const config = buildConfig(database, account, broadcastSyncStatus);
        const provider = createProviderInstance(config, oauthProvider);
        return provider.sync(localEvents as SyncableEvent[], context);
      }),
    );

    const combined: SyncResult = {
      addFailed: INITIAL_ADD_FAILED_COUNT,
      added: INITIAL_ADDED_COUNT,
      removeFailed: INITIAL_REMOVE_FAILED_COUNT,
      removed: INITIAL_REMOVED_COUNT,
    };
    for (const result of results) {
      combined.added += result.added;
      combined.addFailed += result.addFailed;
      combined.removed += result.removed;
      combined.removeFailed += result.removeFailed;
    }
    return combined;
  };

  return { syncForUser };
};

export { createOAuthDestinationProvider };
export type { CreateOAuthProviderOptions };
