import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthTokenProvider } from "./provider";
import type { DestinationProvider } from "../sync/destinations";
import type {
  SyncResult,
  SyncableEvent,
  OAuthProviderConfig,
  BroadcastSyncStatus,
} from "../types";
import type { SyncContext } from "../sync/coordinator";
import { getEventsForDestination } from "../events/events";
import { OAuthCalendarProvider } from "./provider";
import type { OAuthAccount } from "./accounts";

export interface CreateOAuthProviderOptions<
  TAccount extends OAuthAccount,
  TConfig extends OAuthProviderConfig,
> {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  getAccountsForUser: (
    database: BunSQLDatabase,
    userId: string,
  ) => Promise<TAccount[]>;
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

export const createOAuthDestinationProvider = <
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

  const syncForUser = async (
    userId: string,
    context: SyncContext,
  ): Promise<SyncResult | null> => {
    const accounts = await getAccountsForUser(database, userId);
    if (accounts.length === 0) return null;

    const results = await Promise.all(
      accounts.map(async (account) => {
        const localEvents = await getEventsForDestination(
          database,
          account.destinationId,
        );

        const config = buildConfig(database, account, broadcastSyncStatus);
        const provider = createProviderInstance(config, oauthProvider);
        return provider.sync(localEvents as SyncableEvent[], context);
      }),
    );

    return results.reduce<SyncResult>(
      (combined, result) => ({
        added: combined.added + result.added,
        removed: combined.removed + result.removed,
      }),
      { added: 0, removed: 0 },
    );
  };

  return { syncForUser };
};
