import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type AuthType = "oauth" | "caldav" | "none";

interface SourcePreferenceOption {
  id: string;
  label: string;
  description?: string;
  defaultValue: boolean;
  disabled?: boolean;
}

interface SourcePreferencesConfig {
  label: string;
  description?: string;
  options: SourcePreferenceOption[];
}

interface CalDAVProviderConfig {
  serverUrl: string;
  usernameLabel: string;
  usernameHelp: string;
  passwordLabel: string;
  passwordHelp: string;
}

interface ProviderCapabilities {
  canRead: boolean;
  canWrite: boolean;
}

interface ProviderDefinition {
  id: string;
  name: string;
  authType: AuthType;
  icon?: string;
  comingSoon?: boolean;
  caldav?: CalDAVProviderConfig;
  sourcePreferences?: SourcePreferencesConfig;
  capabilities: ProviderCapabilities;
}

interface SyncableEvent {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  startTimeZone?: string;
  recurrenceRule?: object;
  exceptionDates?: object;
  summary: string;
  description?: string;
  location?: string;
  calendarId: string;
  calendarName: string | null;
  calendarUrl: string | null;
}

interface PushResult {
  success: boolean;
  remoteId?: string;
  deleteId?: string;
  error?: string;
  shouldContinue?: boolean;
}

interface DeleteResult {
  success: boolean;
  error?: string;
  shouldContinue?: boolean;
}

interface SyncResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface RemoteEvent {
  uid: string;
  deleteId: string;
  startTime: Date;
  endTime: Date;
  isKeeperEvent: boolean;
}

type SyncOperation =
  | { type: "add"; event: SyncableEvent }
  | { type: "remove"; uid: string; deleteId: string; startTime: Date };

interface ListRemoteEventsOptions {
  until: Date;
}

type BroadcastSyncStatus = (
  userId: string,
  calendarId: string,
  data: { needsReauthentication: boolean },
) => void;

interface ProviderConfig {
  database: BunSQLDatabase;
  userId: string;
  calendarId: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

interface OAuthProviderConfig extends ProviderConfig {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

interface GoogleCalendarConfig extends OAuthProviderConfig {
  externalCalendarId: string;
}

type OutlookCalendarConfig = OAuthProviderConfig;

interface CalDAVConfig extends ProviderConfig {
  serverUrl: string;
  username: string;
  calendarUrl: string;
}

interface SourceEvent {
  uid: string;
  startTime: Date;
  endTime: Date;
  startTimeZone?: string;
  recurrenceRule?: object;
  exceptionDates?: object;
  title?: string;
  description?: string;
  location?: string;
}

interface SourceSyncResult {
  eventsAdded: number;
  eventsRemoved: number;
  syncToken?: string;
  fullSyncRequired?: boolean;
  errors?: Error[];
}

interface OAuthSourceConfig {
  database: BunSQLDatabase;
  userId: string;
  calendarId: string;
  externalCalendarId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  syncToken: string | null;
  calendarAccountId: string;
  oauthCredentialId: string;
}

export type {
  AuthType,
  CalDAVProviderConfig,
  ProviderCapabilities,
  ProviderDefinition,
  SourcePreferenceOption,
  SourcePreferencesConfig,
  SyncableEvent,
  PushResult,
  DeleteResult,
  SyncResult,
  RemoteEvent,
  SyncOperation,
  ListRemoteEventsOptions,
  BroadcastSyncStatus,
  ProviderConfig,
  OAuthProviderConfig,
  GoogleCalendarConfig,
  OutlookCalendarConfig,
  CalDAVConfig,
  SourceEvent,
  SourceSyncResult,
  OAuthSourceConfig,
};
