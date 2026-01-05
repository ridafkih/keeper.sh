import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface SyncableEvent {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description?: string;
  sourceId: string;
  sourceName: string | null;
  sourceUrl: string;
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

export type {
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
};
