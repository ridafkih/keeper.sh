import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEvent,
} from "../types";

interface EventUpdate {
  deleteId: string;
  event: MaterializedSyncableEvent;
  verifiedUid?: string;
}

interface CalendarSyncProvider {
  // Must run before reconciliation, not in the serializer, or mapping and remote disagree and churn forever.
  normalizeEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  prepareEvent?: (event: MaterializedSyncableEvent) => void;
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  updateEvents?: (updates: EventUpdate[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  getRemoteEventsByIds?: (eventIds: string[]) => Promise<RemoteEvent[]>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
  verifyEventsExist?: (targets: EventVerificationTarget[]) => Promise<EventPresence[] | RemoteEvent[]>;
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
  consecutiveUnsettledReads?: number;
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
