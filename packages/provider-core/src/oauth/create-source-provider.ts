import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthTokenProvider } from "./provider";
import type { OAuthSourceProvider } from "./source-provider";
import type { OAuthSourceConfig, SourceSyncResult } from "../types";
import type { RefreshLockStore } from "./refresh-coordinator";
import { allSettledWithConcurrency } from "../utils/concurrency";

const EMPTY_SOURCES_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_INSERTED_COUNT = 0;
const INITIAL_UPDATED_COUNT = 0;
const INITIAL_FILTERED_OUT_OF_WINDOW_COUNT = 0;
const INITIAL_SYNC_TOKEN_RESET_COUNT = 0;
const SOURCE_SYNC_CONCURRENCY = 3;
const SOURCE_SYNC_TIMEOUT_MS = 60_000;

const toError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(String(reason));
};

interface OAuthSourceAccount {
  calendarId: string;
  calendarAccountId: string;
  userId: string;
  externalCalendarId: string;
  syncToken: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  oauthCredentialId: string;
  provider: string;
}

interface SourceProvider {
  syncAllSources(): Promise<SourceSyncResult>;
}

interface CreateOAuthSourceProviderOptions<
  TAccount extends OAuthSourceAccount,
  TConfig extends OAuthSourceConfig,
> {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  refreshLockStore?: RefreshLockStore | null;
  getAllSources: (database: BunSQLDatabase) => Promise<TAccount[]>;
  createProviderInstance: (
    config: TConfig,
    oauthProvider: OAuthTokenProvider,
  ) => OAuthSourceProvider<TConfig>;
  buildConfig: (database: BunSQLDatabase, account: TAccount) => TConfig;
}

const createOAuthSourceProvider = <
  TAccount extends OAuthSourceAccount,
  TConfig extends OAuthSourceConfig,
>(
  options: CreateOAuthSourceProviderOptions<TAccount, TConfig>,
): SourceProvider => {
  const { database, oauthProvider, refreshLockStore, getAllSources, createProviderInstance, buildConfig } = options;

  const syncAllSources = async (): Promise<SourceSyncResult> => {
    const sources = await getAllSources(database);

    if (sources.length === EMPTY_SOURCES_COUNT) {
      return { eventsAdded: INITIAL_ADDED_COUNT, eventsRemoved: INITIAL_REMOVED_COUNT };
    }

    const tasks = sources.map((source) => {
      return async (): Promise<SourceSyncResult> => {
        const config = buildConfig(database, source);
        config.refreshLockStore = refreshLockStore ?? null;
        const provider = createProviderInstance(config, oauthProvider);

        return Promise.race([
          provider.sync(),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error(`Source sync timed out after ${SOURCE_SYNC_TIMEOUT_MS}ms`));
            }, SOURCE_SYNC_TIMEOUT_MS);
          }),
        ]);
      };
    });

    const results = await allSettledWithConcurrency(tasks, {
      concurrency: SOURCE_SYNC_CONCURRENCY,
    });

    const combined: SourceSyncResult = {
      eventsAdded: INITIAL_ADDED_COUNT,
      eventsRemoved: INITIAL_REMOVED_COUNT,
    };
    let eventsInserted = INITIAL_INSERTED_COUNT;
    let eventsUpdated = INITIAL_UPDATED_COUNT;
    let eventsFilteredOutOfWindow = INITIAL_FILTERED_OUT_OF_WINDOW_COUNT;
    let syncTokenResetCount = INITIAL_SYNC_TOKEN_RESET_COUNT;

    const errors: Error[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        combined.eventsAdded += result.value.eventsAdded;
        combined.eventsRemoved += result.value.eventsRemoved;
        eventsInserted += result.value.eventsInserted ?? INITIAL_INSERTED_COUNT;
        eventsUpdated += result.value.eventsUpdated ?? INITIAL_UPDATED_COUNT;
        eventsFilteredOutOfWindow += result.value.eventsFilteredOutOfWindow
          ?? INITIAL_FILTERED_OUT_OF_WINDOW_COUNT;
        syncTokenResetCount += result.value.syncTokenResetCount ?? INITIAL_SYNC_TOKEN_RESET_COUNT;
      } else {
        errors.push(toError(result.reason));
      }
    }

    combined.eventsInserted = eventsInserted;
    combined.eventsUpdated = eventsUpdated;
    combined.eventsFilteredOutOfWindow = eventsFilteredOutOfWindow;
    combined.syncTokenResetCount = syncTokenResetCount;

    if (errors.length > EMPTY_SOURCES_COUNT) {
      combined.errors = errors;
    }

    return combined;
  };

  return { syncAllSources };
};

export { createOAuthSourceProvider };
export type { CreateOAuthSourceProviderOptions, OAuthSourceAccount, SourceProvider };
