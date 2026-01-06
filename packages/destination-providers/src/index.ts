import type { BroadcastSyncStatus, DestinationProvider } from "@keeper.sh/provider-core";
import { createGoogleCalendarProvider } from "@keeper.sh/provider-google-calendar";
import { createCalDAVProvider } from "@keeper.sh/provider-caldav";
import { createFastMailProvider } from "@keeper.sh/provider-fastmail";
import { createICloudProvider } from "@keeper.sh/provider-icloud";
import { createOutlookCalendarProvider } from "@keeper.sh/provider-outlook";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OAuthProvider, OAuthProviders } from "./oauth";

interface DestinationProvidersConfig {
  database: BunSQLDatabase;
  oauthProviders: OAuthProviders;
  encryptionKey: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

const createDestinationProviders = (config: DestinationProvidersConfig): DestinationProvider[] => {
  const { database, oauthProviders, encryptionKey, broadcastSyncStatus } = config;

  const providers: DestinationProvider[] = [];

  const googleOAuth = oauthProviders.getProvider("google");
  if (googleOAuth) {
    providers.push(
      createGoogleCalendarProvider({
        broadcastSyncStatus,
        database,
        oauthProvider: googleOAuth,
      }),
    );
  }

  const outlookOAuth = oauthProviders.getProvider("outlook");
  if (outlookOAuth) {
    providers.push(
      createOutlookCalendarProvider({
        broadcastSyncStatus,
        database,
        oauthProvider: outlookOAuth,
      }),
    );
  }

  providers.push(createCalDAVProvider({ database, encryptionKey }));
  providers.push(createFastMailProvider({ database, encryptionKey }));
  providers.push(createICloudProvider({ database, encryptionKey }));

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

export {
  createOAuthProviders,
  type OAuthProvider,
  type OAuthProviders,
  type OAuthProvidersConfig,
  type OAuthTokens,
  type NormalizedUserInfo,
  type AuthorizationUrlOptions,
  type ValidatedState,
} from "./oauth";
