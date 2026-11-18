import type {
  DeleteResult,
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
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  getRemoteEventsByIds?: (eventIds: string[]) => Promise<RemoteEvent[]>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
  verifyEventsExist?: (deleteIds: string[]) => Promise<RemoteEvent[]>;
  /** The tag this destination writes on its events; see RemoteEvent.ownerTag. */
  ownerTag?: string;
  /** Every UID this destination could have given the event, current scheme first. */
  deriveEventUids?: (event: MaterializedSyncableEvent) => string[];
  /** Writes this destination's tag onto events it already mirrors, leaving their content as is. */
  claimEvents?: (updates: EventUpdate[]) => Promise<PushResult[]>;
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
  endTime: Date;
  id: string;
  startTime: Date;
  syncEventHash: string;
  syncEventId: string;
}

interface PendingChanges {
  inserts: PendingInsert[];
  deletes: string[];
  updates?: PendingUpdate[];
}

export type { CalendarSyncProvider, EventUpdate, PendingChanges, PendingInsert, PendingUpdate };
