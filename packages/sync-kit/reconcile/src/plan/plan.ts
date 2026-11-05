import type {
  BoundedSample,
  DeleteHandle,
  Instant,
  ObservedPrecondition,
  RemoteEventId,
  SyncCursor,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import type { ProvenCoverage } from "../coverage";
import type { SourceIdentity } from "../identity/source-identity";

const tombstoneCauses = [
  "absentFromSnapshot",
  "explicitRemoval",
  "outsideMirrorWindow",
  "destinationDisconnected",
] as const;
type TombstoneCause = (typeof tombstoneCauses)[number];

const unresolvedReasons = [
  "withheldBySource",
  "staleRevision",
  "ambiguousIdentity",
  "missingIdentity",
  "outsideProvenCoverage",
  "corruptKnownState",
  "unsupportedByDestination",
  "provenanceIndeterminate",
  "unmatchedRemoval",
  "removalOutOfScope",
  "pairingCeilingExceeded",
] as const;
type UnresolvedReason = (typeof unresolvedReasons)[number];

const conflictCauses = [
  "sourceChanged",
  "mirrorContentChanged",
  "mirrorTimeChanged",
  "mirrorAvailabilityChanged",
  "mirrorMissing",
  "mirrorReassigned",
] as const;
type ConflictCause = (typeof conflictCauses)[number];

const cursorHoldReasons = ["listingIncomplete", "noCursorOffered"] as const;
type CursorHoldReason = (typeof cursorHoldReasons)[number];

const cursorResetReasons = ["cursorLost", "scopeChanged", "corruptKnownState"] as const;
type CursorResetReason = (typeof cursorResetReasons)[number];

type PlannedWrite =
  | {
      readonly kind: "single";
      readonly at: Instant;
      readonly identity: SourceIdentity;
      readonly intent: WriteIntent;
      readonly retire?: never;
      readonly recreate?: never;
    }
  | {
      readonly kind: "replace";
      readonly at: Instant;
      readonly identity: SourceIdentity;
      readonly retire: Extract<WriteIntent, { kind: "delete" }>;
      readonly recreate: Extract<WriteIntent, { kind: "create" }>;
      readonly intent?: never;
    };

type Tombstone =
  | {
      readonly kind: "retireMirror";
      readonly identity: SourceIdentity;
      readonly cause: TombstoneCause;
      readonly handle: DeleteHandle;
      readonly precondition: ObservedPrecondition;
    }
  | {
      readonly kind: "forgetKnownRow";
      readonly identity: SourceIdentity;
      readonly cause: TombstoneCause;
      readonly handle?: never;
      readonly precondition?: never;
    };

interface Unresolved {
  readonly identity: SourceIdentity | null;
  readonly id: RemoteEventId | null;
  readonly reason: UnresolvedReason;
}

interface Conflict {
  readonly identity: SourceIdentity;
  readonly cause: ConflictCause;
  readonly expected: ObservedPrecondition;
  readonly observed: ObservedPrecondition;
}

type CursorDecision =
  | { readonly kind: "advance"; readonly cursor: SyncCursor }
  | { readonly kind: "hold"; readonly reason: CursorHoldReason }
  | { readonly kind: "reset"; readonly reason: CursorResetReason };

interface PlanDiagnostics {
  readonly unresolved: BoundedSample;
  readonly conflicts: BoundedSample;
  readonly tombstoned: BoundedSample;
  readonly suppressedEchoes: BoundedSample;
  readonly supersededObservations: BoundedSample;
  readonly identitiesConsidered: number;
}

interface Plan {
  readonly writes: readonly PlannedWrite[];
  readonly tombstones: readonly Tombstone[];
  readonly cursor: CursorDecision;
  readonly coverage: ProvenCoverage;
  readonly unresolved: readonly Unresolved[];
  readonly conflicts: readonly Conflict[];
  readonly diagnostics: PlanDiagnostics;
}

type ApplicablePlan = Omit<Plan, "cursor">;

export { conflictCauses, cursorHoldReasons, cursorResetReasons, tombstoneCauses, unresolvedReasons };
export type {
  ApplicablePlan,
  Conflict,
  ConflictCause,
  CursorDecision,
  CursorHoldReason,
  CursorResetReason,
  Plan,
  PlanDiagnostics,
  PlannedWrite,
  Tombstone,
  TombstoneCause,
  Unresolved,
  UnresolvedReason,
};
