import type { BroadcastSyncStatus, DestinationProvider, OAuthProvider, OAuthProviders } from "@keeper.sh/provider-core";
import { createGoogleCalendarProvider } from "@keeper.sh/provider-google-calendar";
import { createCalDAVProvider } from "@keeper.sh/provider-caldav";
import { createFastMailProvider } from "@keeper.sh/provider-fastmail";
import { createICloudProvider } from "@keeper.sh/provider-icloud";
import { createOutlookCalendarProvider } from "@keeper.sh/provider-outlook";
import { getOAuthProviders, getCalDAVProviders } from "./registry";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface DestinationProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
  encryptionKey: string;
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

  for (const provider of getCalDAVProviders()) {
    const factory = CALDAV_FACTORIES[provider.id];
    if (factory) {
      providers.push(factory({ database, encryptionKey }));
    }
  }

  return providers;
};

export {
  createDestinationProviders,
  createGoogleCalendarProvider,
  createCalDAVProvider,
  createFastMailProvider,
  createICloudProvider,
  createOutlookCalendarProvider,
};
export type { DestinationProvidersConfig };
