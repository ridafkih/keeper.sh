import type { BroadcastSyncStatus, DestinationProvider, OAuthProvider, OAuthProviders, SourceProvider } from "@keeper.sh/provider-core";
import { createGoogleCalendarProvider, createGoogleCalendarSourceProvider } from "@keeper.sh/provider-google-calendar";
import { createCalDAVProvider } from "@keeper.sh/provider-caldav";
import { createFastMailProvider } from "@keeper.sh/provider-fastmail";
import { createICloudProvider } from "@keeper.sh/provider-icloud";
import { createOutlookCalendarProvider, createOutlookSourceProvider } from "@keeper.sh/provider-outlook";
import { getOAuthProviders, getCalDAVProviders } from "./registry";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface DestinationProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
  encryptionKey?: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

interface OAuthFactoryConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

interface CalDAVFactoryConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
}

type OAuthFactory = (config: OAuthFactoryConfig) => DestinationProvider;
type CalDAVFactory = (config: CalDAVFactoryConfig) => DestinationProvider;

const OAUTH_FACTORIES: Record<string, OAuthFactory> = {
  google: createGoogleCalendarProvider,
  outlook: createOutlookCalendarProvider,
};

const CALDAV_FACTORIES: Record<string, CalDAVFactory> = {
  caldav: createCalDAVProvider,
  fastmail: createFastMailProvider,
  icloud: createICloudProvider,
};

interface SourceFactoryConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthProvider;
}

type SourceFactory = (config: SourceFactoryConfig) => SourceProvider;

const SOURCE_OAUTH_FACTORIES: Record<string, SourceFactory> = {
  google: createGoogleCalendarSourceProvider,
  outlook: createOutlookSourceProvider,
};

interface SourceProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
}

const getSourceProvider = (
  providerId: string,
  config: SourceProvidersConfig,
): SourceProvider | null => {
  const { database, oauthProviders } = config;
  const factory = SOURCE_OAUTH_FACTORIES[providerId];
  const oauth = oauthProviders.getProvider(providerId);

  if (!factory || !oauth) {
    return null;
  }

  return factory({ database, oauthProvider: oauth });
};

const createDestinationProviders = (config: DestinationProvidersConfig): DestinationProvider[] => {
  const { database, oauthProviders, encryptionKey, broadcastSyncStatus } = config;

  const providers: DestinationProvider[] = [];

  for (const provider of getOAuthProviders()) {
    const factory = OAUTH_FACTORIES[provider.id];
    const oauth = oauthProviders.getProvider(provider.id);
    if (factory && oauth) {
      providers.push(factory({ broadcastSyncStatus, database, oauthProvider: oauth }));
    }
  }

  if (encryptionKey) {
    for (const provider of getCalDAVProviders()) {
      const factory = CALDAV_FACTORIES[provider.id];
      if (factory) {
        providers.push(factory({ database, encryptionKey }));
      }
    }
  }

  return providers;
};

export {
  createDestinationProviders,
  getSourceProvider,
  createGoogleCalendarProvider,
  createCalDAVProvider,
  createFastMailProvider,
  createICloudProvider,
  createOutlookCalendarProvider,
};
export type { DestinationProvidersConfig, SourceProvidersConfig };
