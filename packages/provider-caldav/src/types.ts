import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SyncableEvent } from "@keeper.sh/provider-core";

interface CalDAVProviderOptions {
  providerId: string;
  providerName: string;
}

interface CalDAVProviderConfig {
  database: PostgresJsDatabase;
  encryptionKey: string;
}

interface CalDAVAccount {
  destinationId: string;
  userId: string;
  provider: string;
  accountId: string;
  email: string | null;
  serverUrl: string;
  calendarUrl: string;
  username: string;
  encryptedPassword: string;
}

interface CalDAVSourceAccount {
  sourceId: string;
  userId: string;
  provider: string;
  serverUrl: string;
  calendarUrl: string;
  name: string;
  username: string;
  encryptedPassword: string;
  syncToken: string | null;
}

interface CalDAVSourceConfig {
  database: PostgresJsDatabase;
  sourceId: string;
  userId: string;
  calendarUrl: string;
  serverUrl: string;
  syncToken: string | null;
}

interface CalDAVSourceProviderConfig {
  database: PostgresJsDatabase;
  encryptionKey: string;
}

interface CalDAVSourceSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  syncToken: string | null;
}

interface CalDAVServiceConfig {
  database: PostgresJsDatabase;
  encryptionKey: string;
}

interface CalDAVService {
  getCalDAVAccountsForUser: (userId: string, providerFilter?: string) => Promise<CalDAVAccount[]>;
  getCalDAVAccountsByProvider: (provider: string) => Promise<CalDAVAccount[]>;
  getDecryptedPassword: (encryptedPassword: string) => string;
  getUserEvents: (userId: string) => Promise<SyncableEvent[]>;
}

interface CalDAVClientConfig {
  serverUrl: string;
  credentials: {
    username: string;
    password: string;
  };
}

interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
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
};
