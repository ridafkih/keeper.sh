import type {
  DeleteResult,
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
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  getRemoteEventsByIds?: (eventIds: string[]) => Promise<RemoteEvent[]>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
  // Google answers three-valued; Outlook still answers with the events it found and throws when it cannot tell.
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
  startTime: Date;
  endTime: Date;
}

interface PendingUpdate {
  consecutiveUpdateFailures?: number;
  deleteIdentifier: string;
  destinationEventUid?: string;
  endTime: Date;
  id: string;
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
