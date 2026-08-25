import type {
  DeleteResult,
  EventAvailability,
  EventPresence,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEvent,
} from "../types";

interface EventUpdate {
  deleteId: string;
  event: MaterializedSyncableEvent;
}

interface CalendarSyncProvider {
  // Must run before reconciliation, not in the serializer, or mapping and remote disagree and churn forever.
  normalizeEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  updateEvents?: (updates: EventUpdate[]) => Promise<PushResult[]>;
  /* Whether this provider's create verb can succeed on bytes its update verb refused. A CalDAV
     PUT goes to a freshly derived href with its own preconditions; a Graph POST and a Google
     import carry the same serialization to the same collection and are refused again. */
  createEscapesPayloadRefusal?: boolean;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  getRemoteEventsByIds?: (eventIds: string[]) => Promise<RemoteEvent[]>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
  // Google, Outlook and CalDAV answer three-valued, so "could not tell" is never read as absence.
  verifyEventsExist?: (deleteIds: string[]) => Promise<EventPresence[] | RemoteEvent[]>;
}

interface PendingInsert {
  eventStateId: string;
  sourceCalendarId: string;
  syncEventId: string;
  calendarId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  remoteContentHash: string | null;
  /* Absent is the safe reading of a missing proof: nothing is adopted without one. */
  remoteContentHashRepairedFrom?: string | null;
  remoteStartTime: Date | null;
  remoteEndTime: Date | null;
  remoteAvailability: EventAvailability | null;
  startTime: Date;
  endTime: Date;
}

interface PendingUpdate {
  consecutiveUpdateFailures?: number;
  deleteIdentifier: string;
  destinationEventUid?: string;
  endTime: Date;
  id: string;
  /* Absent means the capture observed nothing; the recorded baseline is then left as it stands. */
  remoteContentHash?: string;
  /*
   * Written as given, absent reading as null: a repair the destination has since confirmed must
   * be cleared, or a later edit of that same form would be adopted as our own text.
   */
  remoteContentHashRepairedFrom?: string | null;
  /*
   * Null only when nothing is known: an empty capture writes back the baseline the operation
   * carries rather than clearing it, and the flush coalesces a remaining null away. Nulling a
   * recorded baseline sends the next pass back to comparing against local intent, which churns.
   */
  remoteStartTime?: Date | null;
  remoteEndTime?: Date | null;
  remoteAvailability?: EventAvailability | null;
  startTime: Date;
  syncEventHash: string | null;
  syncEventId: string;
}

interface PendingChanges {
  inserts: PendingInsert[];
  deletes: string[];
  updates?: PendingUpdate[];
}

export type { CalendarSyncProvider, EventUpdate, PendingChanges, PendingInsert, PendingUpdate };
