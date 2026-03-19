interface SocketMessage {
  data?: unknown;
  event: string;
}

interface SyncAggregate {
  progressPercent: number;
  seq: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  syncing: boolean;
  lastSyncedAt?: string | null;
  pending?: boolean;
}

const isSocketMessage = (value: unknown): value is SocketMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "event" in value && typeof value.event === "string";
};

const isSyncAggregate = (value: unknown): value is SyncAggregate => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "progressPercent" in value &&
    typeof value.progressPercent === "number" &&
    "seq" in value &&
    typeof value.seq === "number" &&
    "syncEventsProcessed" in value &&
    typeof value.syncEventsProcessed === "number" &&
    "syncEventsRemaining" in value &&
    typeof value.syncEventsRemaining === "number" &&
    "syncEventsTotal" in value &&
    typeof value.syncEventsTotal === "number" &&
    "syncing" in value &&
    typeof value.syncing === "boolean"
  );
};

export { type SocketMessage, type SyncAggregate, isSocketMessage, isSyncAggregate };
