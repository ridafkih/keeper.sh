import type { SyncableEvent, PushResult, DeleteResult, RemoteEvent } from "../types";

interface CalendarSyncProvider {
  pushEvents: (events: SyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: () => Promise<RemoteEvent[]>;
}

interface PendingInsert {
  eventStateId: string;
  calendarId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  startTime: Date;
  endTime: Date;
}

interface PendingChanges {
  inserts: PendingInsert[];
  deletes: string[];
}

export type { CalendarSyncProvider, PendingChanges, PendingInsert };
