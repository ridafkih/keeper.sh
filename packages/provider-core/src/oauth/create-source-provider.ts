import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthTokenProvider } from "./provider";
import type { OAuthSourceProvider } from "./source-provider";
import type { OAuthSourceConfig, SourceSyncResult } from "../types";

const EMPTY_SOURCES_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;

const toError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(String(reason));
};

interface OAuthSourceAccount {
  sourceId: string;
  userId: string;
  externalCalendarId: string;
  syncToken: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  credentialId: string;
  oauthCredentialId?: string;
  oauthSourceCredentialId?: string;
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
  const { database, oauthProvider, getAllSources, createProviderInstance, buildConfig } = options;

  const syncAllSources = async (): Promise<SourceSyncResult> => {
    const sources = await getAllSources(database);

    if (sources.length === EMPTY_SOURCES_COUNT) {
      return { eventsAdded: INITIAL_ADDED_COUNT, eventsRemoved: INITIAL_REMOVED_COUNT };
    }

    const results = await Promise.allSettled(
      sources.map((source) => {
        const config = buildConfig(database, source);
        const provider = createProviderInstance(config, oauthProvider);
        return provider.sync();
      }),
    );

    const combined: SourceSyncResult = {
      eventsAdded: INITIAL_ADDED_COUNT,
      eventsRemoved: INITIAL_REMOVED_COUNT,
    };

    const errors: Error[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        combined.eventsAdded += result.value.eventsAdded;
        combined.eventsRemoved += result.value.eventsRemoved;
      } else {
        errors.push(toError(result.reason));
      }
    }

    if (errors.length > EMPTY_SOURCES_COUNT) {
      combined.errors = errors;
    }

    return combined;
  };

  return { syncAllSources };
};

export { createOAuthSourceProvider };
export type { CreateOAuthSourceProviderOptions, OAuthSourceAccount, SourceProvider };
