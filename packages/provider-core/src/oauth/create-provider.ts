import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthTokenProvider } from "./provider";
import type { DestinationProvider } from "../sync/destinations";
import type {
  BroadcastSyncStatus,
  OAuthProviderConfig,
  SyncResult,
  SyncableEvent,
} from "../types";
import type { RefreshLockStore } from "./refresh-coordinator";
import type { SyncContext } from "../sync/coordinator";
import { getEventsForDestination } from "../events/events";
import { widelog } from "widelogger";
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
  refreshLockStore?: RefreshLockStore | null;
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
  prepareLocalEvents?: (events: SyncableEvent[], account: TAccount) => SyncableEvent[];
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
    refreshLockStore,
    getAccountsForUser,
    createProviderInstance,
    buildConfig,
    prepareLocalEvents,
  } = options;

  const getLocalEvents = (localEvents: SyncableEvent[], account: TAccount) => {
    if (!prepareLocalEvents) {
      return localEvents;
    }
    return prepareLocalEvents(localEvents, account);
  };

  const syncForUser = async (userId: string, context: SyncContext): Promise<SyncResult | null> => {
    const accounts = await getAccountsForUser(database, userId);
    if (accounts.length === EMPTY_ACCOUNTS_COUNT) {
      return null;
    }

    const results = await Promise.all(
      accounts.map((account) => {
        widelog.set("operation.name", "sync:destination-account");
        widelog.set("operation.type", "sync");
        widelog.set("destination.calendar_id", account.calendarId);
        widelog.set("user.id", userId);
        if (context.jobName) {
          widelog.set("job.name", context.jobName);
        }
        if (context.jobType) {
          widelog.set("job.type", context.jobType);
        }

        return widelog.time.measure("sync.destination_account.duration_ms", async () => {
          const localEvents = await getEventsForDestination(database, account.calendarId);
          const preparedEvents = getLocalEvents(localEvents, account);
          widelog.set("local_events.count", preparedEvents.length);

          const config = buildConfig(database, account, broadcastSyncStatus);
          config.refreshLockStore = refreshLockStore ?? null;
          const provider = createProviderInstance(config, oauthProvider);
          const result = await provider.sync(preparedEvents, context);

          widelog.set("events.added", result.added);
          widelog.set("events.add_failed", result.addFailed);
          widelog.set("events.removed", result.removed);
          widelog.set("events.remove_failed", result.removeFailed);

          return result;
        });
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
