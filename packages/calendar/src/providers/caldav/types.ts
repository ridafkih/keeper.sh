import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../../core/types";

interface CalDAVProviderOptions {
  providerId: string;
  providerName: string;
}

interface CalDAVProviderConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
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
  encryptedPassword: string;
}

interface CalDAVSourceAccount {
  calendarAccountId: string;
  calendarId: string;
  userId: string;
  provider: string;
  serverUrl: string;
  calendarUrl: string;
  name: string;
  originalName: string | null;
  username: string;
  encryptedPassword: string;
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
  encryptionKey: string;
}

interface CalDAVSourceSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  syncToken: string | null;
}

interface CalDAVServiceConfig {
  database: BunSQLDatabase;
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
