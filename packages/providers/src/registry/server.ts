import type {
  BroadcastSyncStatus,
  DestinationProvider,
  OAuthProvider,
  OAuthProviders,
  RefreshLockStore,
  SourceProvider,
} from "../core";
import {
  createGoogleCalendarProvider,
  createGoogleCalendarSourceProvider,
} from "../google";
import { createCalDAVProvider } from "../caldav";
import { createFastMailProvider } from "../fastmail";
import { createICloudProvider } from "../icloud";
import {
  createOutlookCalendarProvider,
  createOutlookSourceProvider,
} from "../outlook";
import { getOAuthProviders, getCalDAVProviders } from "./registry";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface DestinationProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
  encryptionKey?: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
  refreshLockStore?: RefreshLockStore | null;
}

interface OAuthFactoryConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  refreshLockStore?: RefreshLockStore | null;
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
  refreshLockStore?: RefreshLockStore | null;
}

type SourceFactory = (config: SourceFactoryConfig) => SourceProvider;

const SOURCE_OAUTH_FACTORIES: Record<string, SourceFactory> = {
  google: createGoogleCalendarSourceProvider,
  outlook: createOutlookSourceProvider,
};

interface SourceProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
  refreshLockStore?: RefreshLockStore | null;
}

const getSourceProvider = (
  providerId: string,
  config: SourceProvidersConfig,
): SourceProvider | null => {
  const { database, oauthProviders, refreshLockStore } = config;
  const factory = SOURCE_OAUTH_FACTORIES[providerId];
  const oauth = oauthProviders.getProvider(providerId);

  if (!factory || !oauth) {
    return null;
  }

  return factory({ database, oauthProvider: oauth, refreshLockStore });
};

const createDestinationProviders = (config: DestinationProvidersConfig): DestinationProvider[] => {
  const { database, oauthProviders, encryptionKey, broadcastSyncStatus, refreshLockStore } = config;

  const providers: DestinationProvider[] = [];

  for (const provider of getOAuthProviders()) {
    const factory = OAUTH_FACTORIES[provider.id];
    const oauth = oauthProviders.getProvider(provider.id);
    if (factory && oauth) {
      providers.push(factory({ broadcastSyncStatus, database, oauthProvider: oauth, refreshLockStore }));
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
