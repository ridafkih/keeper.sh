import type { CalendarDiscoveryCache } from "./shared/discovery-cache";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { Keyring, StoredSecret } from "@keeper.sh/database";

type StoredCalDAVPassword = StoredSecret<"caldav_credentials.encryptedPassword">;

interface CalDAVProviderOptions {
  providerId: string;
  providerName: string;
}

interface CalDAVProviderConfig {
  database: BunSQLDatabase;
  keyring: Keyring;
}

interface CalDAVAccount {
  calendarId: string;
  userId: string;
  provider: string;
  accountId: string | null;
  email: string | null;
  serverUrl: string;
  calendarUrl: string;
  username: string;
  caldavCredentialId: string;
  encryptedPassword: StoredCalDAVPassword;
}

interface CalDAVSourceAccount {
  authMethod: string;
  calendarAccountId: string;
  calendarId: string;
  userId: string;
  provider: string;
  serverUrl: string;
  calendarUrl: string;
  name: string;
  originalName: string | null;
  username: string;
  caldavCredentialId: string;
  encryptedPassword: StoredCalDAVPassword;
  syncToken: string | null;
}

interface CalDAVSourceConfig {
  database: BunSQLDatabase;
  calendarId: string;
  userId: string;
  calendarUrl: string;
  serverUrl: string;
  syncToken: string | null;
}

interface CalDAVSourceProviderConfig {
  database: BunSQLDatabase;
  keyring: Keyring;
}

interface CalDAVSourceSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  syncToken: string | null;
}

interface CalDAVServiceConfig {
  database: BunSQLDatabase;
  keyring: Keyring;
}

interface CalDAVService {
  getCalDAVAccountsForUser: (userId: string, providerFilter?: string) => Promise<CalDAVAccount[]>;
  getCalDAVAccountsByProvider: (provider: string) => Promise<CalDAVAccount[]>;
  getDecryptedPassword: (
    credential: Pick<CalDAVAccount, "caldavCredentialId" | "encryptedPassword">,
  ) => string;
}

interface CalDAVClientConfig {
  serverUrl: string;
  credentials: {
    username: string;
    password: string;
  };
  authMethod?: "basic" | "digest";
  /* Awaited before every HTTP request the client sends to the origin. */
  onBeforeRequest?: () => Promise<void> | void;
  calendarDiscoveryCache?: CalendarDiscoveryCache;
}

interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
  timeZone?: string;
  writable: boolean;
}

export type {
  CalDAVProviderOptions,
  CalDAVProviderConfig,
  CalDAVAccount,
  CalDAVServiceConfig,
  CalDAVService,
  CalDAVClientConfig,
  CalendarInfo,
  CalDAVSourceAccount,
  CalDAVSourceConfig,
  CalDAVSourceProviderConfig,
  CalDAVSourceSyncResult,
  StoredCalDAVPassword,
};
