export interface SyncableEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description?: string;
  sourceId: string;
  sourceName?: string;
}

export interface PushResult {
  success: boolean;
  remoteId?: string;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface ProviderConfig {
  userId: string;
  accessToken?: string;
  calendarId?: string;
}
