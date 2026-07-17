import type {
  DeleteResult,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../types";

interface CalendarSyncProvider {
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
}

interface PendingInsert {
  eventStateId: string;
  syncEventId: string;
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
