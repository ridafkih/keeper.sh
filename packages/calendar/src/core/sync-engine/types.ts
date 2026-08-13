import type {
  DeleteResult,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../types";

interface CalendarSyncProvider {
  /*
   * Reconciliation compares mapped times against the times the destination reports, so a
   * range the provider rewrites on the way out has to be rewritten here too. Normalizing
   * before the diff keeps the mapping, the content hash, and the pushed resource agreeing
   * on one range; normalizing inside the serializer alone would make every later run read
   * the remote event as changed and replace it.
   */
  normalizeEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
}

interface PendingInsert {
  eventStateId: string;
  sourceCalendarId: string;
  syncEventId: string;
  calendarId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  startTime: Date;
  endTime: Date;
}

interface PendingUpdate {
  deleteIdentifier: string;
  id: string;
  syncEventHash: string;
  syncEventId: string;
}

interface PendingChanges {
  inserts: PendingInsert[];
  deletes: string[];
  updates?: PendingUpdate[];
}

export type { CalendarSyncProvider, PendingChanges, PendingInsert, PendingUpdate };
