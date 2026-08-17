import type {
  CalendarKey,
  ChangeListing,
  DeleteHandle,
  EventTime,
  EventUid,
  IdempotencyKey,
  Instant,
  ObservedPrecondition,
  RecurrenceAnchor,
  RemoteEventId,
} from "@keeper.sh/sync-protocol";
import type {
  CursorDecision,
  ProvenCoverage,
  TombstoneCause,
  UnresolvedReason,
} from "@keeper.sh/sync-reconcile";
import type { CoverageProofRefusal } from "../input/stored-coverage";

const deletionOrigins = ["tombstone", "replaceRetire"] as const;
type DeletionOrigin = (typeof deletionOrigins)[number];

const deleteHandleSources = ["observedListing", "storedMapping"] as const;
type DeleteHandleSource = (typeof deleteHandleSources)[number];

type RecurrenceIdentity =
  | { readonly kind: "master" }
  | { readonly kind: "override"; readonly recurrenceInstant: Instant }
  | { readonly kind: "slot"; readonly start: Instant; readonly end: Instant };

type EntryTime =
  | { readonly kind: "occurrence"; readonly time: EventTime }
  | { readonly kind: "seriesAnchor"; readonly anchor: RecurrenceAnchor }
  | { readonly kind: "unrecorded" };

interface DeletionEntry {
  readonly origin: DeletionOrigin;
  readonly cause: TombstoneCause;
  readonly identityKey: string;
  readonly uid: EventUid;
  readonly recurrence: RecurrenceIdentity;
  readonly remoteEventId: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly handleSource: DeleteHandleSource;
  readonly time: EntryTime;
  readonly sourceCalendar: CalendarKey;
  readonly destinationCalendar: CalendarKey;
  readonly preconditionKind: ObservedPrecondition["kind"];
  readonly licensedBy: ProvenCoverage["kind"];
  readonly signature: string;
}

interface ReplacementEntry {
  readonly identityKey: string;
  readonly uid: EventUid;
  readonly recurrence: RecurrenceIdentity;
  readonly retireHandle: DeleteHandle;
  readonly recreateIdempotencyKey: IdempotencyKey;
  readonly sourceCalendar: CalendarKey;
  readonly signature: string;
}

interface CreationEntry {
  readonly identityKey: string;
  readonly uid: EventUid;
  readonly recurrence: RecurrenceIdentity;
  readonly idempotencyKey: IdempotencyKey;
  readonly time: EntryTime;
  readonly sourceCalendar: CalendarKey;
  readonly signature: string;
}

interface UpdateEntry {
  readonly identityKey: string;
  readonly uid: EventUid;
  readonly recurrence: RecurrenceIdentity;
  readonly target: RemoteEventId;
  readonly preconditionKind: ObservedPrecondition["kind"];
  readonly time: EntryTime;
  readonly sourceCalendar: CalendarKey;
  readonly signature: string;
}

interface ForgottenRowEntry {
  readonly identityKey: string;
  readonly uid: EventUid;
  readonly cause: TombstoneCause;
  readonly sourceCalendar: CalendarKey;
}

interface UnresolvedEntry {
  readonly reason: UnresolvedReason;
  readonly identityKey: string | null;
  readonly id: RemoteEventId | null;
  readonly sourceCalendar: CalendarKey;
}

interface CoverageVerdict {
  readonly sourceCalendar: CalendarKey;
  readonly kind: ProvenCoverage["kind"];
  readonly refusal: CoverageProofRefusal | null;
  readonly listingKind: ChangeListing["kind"];
  readonly recordedAt: Instant | null;
  readonly ageSeconds: number | null;
  readonly cursor: CursorDecision;
}

const catalogCaveats = [
  "mirrorWindowRetirementSuppressed",
  "noSourceRemovalSignal",
  "coverageStalerThanTheLiveEngineAccepts",
  "crossSourceInteractionsInvisible",
  "underReportsRelativeToLiveEngine",
] as const;
type CatalogCaveat = (typeof catalogCaveats)[number];

export { catalogCaveats, deleteHandleSources, deletionOrigins };
export type {
  CatalogCaveat,
  CoverageVerdict,
  CreationEntry,
  DeleteHandleSource,
  DeletionEntry,
  DeletionOrigin,
  EntryTime,
  ForgottenRowEntry,
  RecurrenceIdentity,
  ReplacementEntry,
  UnresolvedEntry,
  UpdateEntry,
};
