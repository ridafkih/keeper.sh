export { ReconcileInternalDataError } from "./errors";

export { defaultPlanLimits, defaultWindowMembership } from "./policy";
export type { PlanLimits, ReconciliationPolicy } from "./policy";

export { insideProvenCoverage } from "./coverage";
export type { ProvenCoverage } from "./coverage";

export { sourceIdentityKey } from "./identity/source-identity";
export type { SourceIdentity } from "./identity/source-identity";
export { observedSourceIdentity } from "./identity/observed-identity";
export { calendarKeyString } from "./identity/calendar-key";
export {
  mirrorFingerprintOf,
  sameMirror,
  sameSource,
  sourceFingerprintOf,
} from "./identity/fingerprints";
export type { MirrorFingerprint, SourceFingerprint } from "./identity/fingerprints";

export type { ObservedState } from "./state/observed";
export { indexKnownEvents } from "./state/known";
export type { CorruptKnownRow, KnownEvent, KnownIndex, KnownState } from "./state/known";
export { indexMappings } from "./state/mappings";
export type { Mapping, MappingIndexes, MappingSet } from "./state/mappings";
export { compareObservedRevisions, dedupeObservations } from "./state/dedupe";
export type { DedupedObservations, IdentifiedEvent } from "./state/dedupe";

export {
  listingAuthorities,
  listingAuthority,
  mayRetireItsOwnMirrors,
  speaksForAbsence,
} from "./presence/authority";
export type { ListingAuthority } from "./presence/authority";
export { presenceBasis } from "./presence/presence-basis";
export type { PresenceBasis } from "./presence/presence-basis";
export { writeBasis } from "./presence/write-basis";
export { removalBasis } from "./presence/removals";
export type { RemovalBasis } from "./presence/removals";

export {
  conflictCauses,
  cursorHoldReasons,
  cursorResetReasons,
  tombstoneCauses,
  unresolvedReasons,
} from "./plan/plan";
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
} from "./plan/plan";

export { classifyProvenance, isRetirable, provenanceDispositions } from "./plan/echo";
export type { ProvenanceDisposition } from "./plan/echo";
export { comparePlannedWrites } from "./plan/order";
export { boundedSample } from "./plan/diagnostics";
export { decideCursor } from "./plan/cursor";
export { classifyConflict } from "./plan/conflicts";
export { deriveWrites, mirrorIdempotencyKey } from "./plan/writes";
export type { WriteDerivation } from "./plan/writes";
export { deriveTombstones } from "./plan/tombstones";
export type { TombstoneDerivation } from "./plan/tombstones";
export { pairReassignedOccurrences } from "./plan/reassignment";
export type { Reassignment, ReassignmentPairing } from "./plan/reassignment";

export { planReconciliation } from "./plan/plan-reconciliation";
