import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export interface SyncableEvent {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description?: string;
  sourceId: string;
  sourceName?: string;
  sourceUrl: string;
}

export interface PushResult {
  success: boolean;
  remoteId?: string;
  deleteId?: string;
  error?: string;
  shouldContinue?: boolean;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
  shouldContinue?: boolean;
}

export interface SyncResult {
  added: number;
  removed: number;
}

export interface RemoteEvent {
  uid: string;
  deleteId: string;
  startTime: Date;
  endTime: Date;
}

export type SyncOperation =
  | { type: "add"; event: SyncableEvent }
  | { type: "remove"; uid: string; deleteId: string; startTime: Date };

export interface ListRemoteEventsOptions {
  until: Date;
}

export type BroadcastSyncStatus = (
  userId: string,
  destinationId: string,
  data: { needsReauthentication: boolean },
) => void;

export interface ProviderConfig {
  database: BunSQLDatabase;
  userId: string;
  destinationId: string;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

export interface GoogleCalendarConfig extends ProviderConfig {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  calendarId: string;
}

export interface OutlookCalendarConfig extends ProviderConfig {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export interface CalDAVConfig extends ProviderConfig {
  serverUrl: string;
  username: string;
  calendarUrl: string;
}
