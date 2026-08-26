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
  /* The uid a verification read observed on the object living at deleteId, carried only when a read
     actually saw it. A destination that re-keys its objects hands back an opaque identifier that
     says nothing about the uid inside, so a provider which guards its update verb by inspecting the
     identifier has no other way to tell a relocated mirror from an identifier naming a different
     event - and refusing the write would leave the customer's edit undelivered forever. */
  verifiedUid?: string;
}

interface CalendarSyncProvider {
  // Must run before reconciliation, not in the serializer, or mapping and remote disagree and churn forever.
  normalizeEvent?: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
  /* Builds the create-side payload for one event with no side effect, running exactly the
     serialization pushEvents runs. It exists so a caller can prove a recreate is possible BEFORE
     it destroys the live mirror: a serializer refusal is ours, it repeats every cycle, and a
     DELETE issued ahead of it buys nothing but the permanent loss of the customer's only copy.
     It throws for the same events the create verb throws for. */
  prepareEvent?: (event: MaterializedSyncableEvent) => void;
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  updateEvents?: (updates: EventUpdate[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: (options: ListRemoteEventsOptions) => Promise<RemoteEvent[]>;
  getRemoteEventsByIds?: (eventIds: string[]) => Promise<RemoteEvent[]>;
  getThrottleMetrics?: () => ProviderThrottleMetrics;
  getSyncDiagnostics?: () => Record<string, number | string>;
  /* Google, Outlook and CalDAV answer three-valued, so "could not tell" is never read as absence.
     The target carries the uid as well as the delete id: without it Outlook can never say absent. */
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
  /* Reads that settled nothing, counted apart from the answered-refusal tally above: one shared
     counter let either kind of evidence top the other up, and an unknown read is not evidence
     about the object at all. */
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
