import type { OAuthProvider, OAuthProviders } from "../../core/oauth/providers";
import type { RefreshLockStore } from "../../core/oauth/refresh-coordinator";
import type { SourceProvider } from "../../core/oauth/create-source-provider";
import {
  createGoogleCalendarSourceProvider,
} from "../../providers/google";
import {
  createOutlookSourceProvider,
} from "../../providers/outlook";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface SourceFactoryConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
  oauthProvider: OAuthProvider;
  refreshLockStore?: RefreshLockStore | null;
}

type SourceFactory = (config: SourceFactoryConfig) => SourceProvider;

const SOURCE_OAUTH_FACTORIES: Record<string, SourceFactory> = {
  google: createGoogleCalendarSourceProvider,
  outlook: createOutlookSourceProvider,
};

interface SourceProvidersConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
  oauthProviders: OAuthProviders;
  refreshLockStore?: RefreshLockStore | null;
}

const getSourceProvider = (
  providerId: string,
  config: SourceProvidersConfig,
): SourceProvider | null => {
  const { database, encryptionKey, oauthProviders, refreshLockStore } = config;
  const factory = SOURCE_OAUTH_FACTORIES[providerId];
  const oauth = oauthProviders.getProvider(providerId);

  if (!factory || !oauth) {
    return null;
  }

  return factory({ database, encryptionKey, oauthProvider: oauth, refreshLockStore });
};

export { getSourceProvider };
export type { SourceProvidersConfig };
