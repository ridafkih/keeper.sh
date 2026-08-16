import type {
  DeleteResult,
  EventAvailability,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEventListing,
  RemoteEventPresence,
  RemoteEventReference,
} from "../types";

interface CalendarSyncProvider {
  // Must run before reconciliation, not in the serializer, or mapping and remote disagree and churn forever.
  normalizeEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEventListing>;
  probeRemoteEvent?: (
    reference: RemoteEventReference,
  ) => Promise<RemoteEventPresence>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
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
  id: string;
  deleteIdentifier?: string;
  destinationAvailability?: EventAvailability | null;
  destinationContentHash?: string | null;
  destinationDescription?: string | null;
  destinationEndTime?: Date | null;
  destinationIsAllDay?: boolean | null;
  destinationLocation?: string | null;
  destinationStartTime?: Date | null;
  destinationSummary?: string | null;
  missingFirstObservedAt?: Date | null;
  missingObservationCount?: number;
  syncEventHash?: string;
  syncEventId?: string;
}

interface PendingChanges {
  inserts: PendingInsert[];
  deletes: string[];
  updates?: PendingUpdate[];
}

export type { CalendarSyncProvider, PendingChanges, PendingInsert, PendingUpdate };
