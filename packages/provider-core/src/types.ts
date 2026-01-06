import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type AuthType = "oauth" | "caldav";

interface CalDAVProviderConfig {
  serverUrl: string;
  usernameLabel: string;
  usernameHelp: string;
  passwordLabel: string;
  passwordHelp: string;
}

interface ProviderDefinition {
  id: string;
  name: string;
  authType: AuthType;
  icon?: string;
  comingSoon?: boolean;
  caldav?: CalDAVProviderConfig;
}

interface SyncableEvent {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description?: string;
  sourceId: string;
  sourceName: string | null;
  sourceUrl: string | null;
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
}

type SyncOperation =
  | { type: "add"; event: SyncableEvent }
  | { type: "remove"; uid: string; deleteId: string; startTime: Date };

interface ListRemoteEventsOptions {
  until: Date;
}

type BroadcastSyncStatus = (
  userId: string,
  destinationId: string,
  data: { needsReauthentication: boolean },
) => void;

interface ProviderConfig {
  database: BunSQLDatabase;
  userId: string;
  destinationId: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

interface OAuthProviderConfig extends ProviderConfig {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

interface GoogleCalendarConfig extends OAuthProviderConfig {
  calendarId: string;
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
  sourceId: string;
  externalCalendarId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  syncToken: string | null;
  destinationId?: string;
  oauthCredentialId?: string;
  oauthSourceCredentialId?: string;
}

export type {
  AuthType,
  CalDAVProviderConfig,
  ProviderDefinition,
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
