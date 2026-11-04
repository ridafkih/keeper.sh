interface DestinationSyncResult {
  userId: string;
  calendarId: string;
  localEventCount: number;
  remoteEventCount: number;
  broadcast?: boolean;
  completedSuccessfully?: boolean;
}

type SyncStage = "fetching" | "comparing" | "processing" | "error";

interface SyncPace {
  lane: string;
  operationsPerMinute: number;
}

interface SyncProgressUpdate {
  userId: string;
  calendarId: string;
  status: "syncing" | "error";
  stage: SyncStage;
  localEventCount: number;
  remoteEventCount: number;
  progress?: { current: number; total: number };
  lastOperation?: { type: "add" | "remove"; eventTime: string };
  inSync: false;
  error?: string;
  pace?: SyncPace;
}

export type { DestinationSyncResult, SyncPace, SyncStage, SyncProgressUpdate };
