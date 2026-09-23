import type {
  IdempotencyKey,
  NormalizedContent,
  RemoteEvent,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import { calendarKeyString } from "../identity/calendar-key";
import type { SourceFingerprint } from "../identity/fingerprints";
import {
  mirrorFingerprintOf,
  sameMirror,
  sameSource,
  sourceFingerprintOf,
} from "../identity/fingerprints";
import { joinOnNul } from "../identity/nul";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey } from "../identity/source-identity";
import type { ReconciliationPolicy } from "../policy";
import type { IdentifiedEvent } from "../state/dedupe";
import type { TimeShape } from "../state/event-shape";
import { startInstantOf, timeShapeOf } from "../state/event-shape";
import type { KnownEvent, KnownIndex } from "../state/known";
import type { Mapping, MappingIndexes } from "../state/mappings";
import type { MirrorIndex } from "../state/mirrors";
import { revisionOutranks } from "../state/revision";
import { conflictCauseOf } from "./conflicts";
import type { Conflict, PlannedWrite, Unresolved } from "./plan";
import { observedPreconditionOf, samePrecondition } from "./preconditions";
import { pairReassignedOccurrences } from "./reassignment";
import type { Reassignment, ReassignmentPairing } from "./reassignment";

interface WriteInput {
  readonly observations: readonly IdentifiedEvent[];
  readonly orphanedMappings: readonly Mapping[];
  readonly known: KnownIndex;
  readonly indexes: MappingIndexes;
  readonly mirrors: MirrorIndex;
  readonly policy: ReconciliationPolicy;
}

interface WriteDerivation {
  readonly writes: readonly PlannedWrite[];
  readonly conflicts: readonly Conflict[];
  readonly unresolved: readonly Unresolved[];
  readonly claimedMappingKeys: readonly string[];
}

type Decision =
  | { readonly kind: "none" }
  | { readonly kind: "write"; readonly write: PlannedWrite }
  | { readonly kind: "conflict"; readonly conflict: Conflict }
  | { readonly kind: "unresolved"; readonly unresolved: Unresolved };

const nothingToDo: Decision = { kind: "none" };

const mirrorIdempotencyKey = (
  identity: SourceIdentity,
  policy: ReconciliationPolicy,
): IdempotencyKey => ({
  kind: "idempotencyKey",
  value: joinOnNul([calendarKeyString(policy.destination.key), sourceIdentityKey(identity)]),
});

const normalizedContentOf = (
  event: RemoteEvent,
  policy: ReconciliationPolicy,
): NormalizedContent => ({
  kind: "normalized",
  provider: policy.destination.key.provider,
  content: event.content,
  fingerprint: event.fingerprint,
});

const createIntentFor = (
  observation: IdentifiedEvent,
  policy: ReconciliationPolicy,
): Extract<WriteIntent, { kind: "create" }> => ({
  kind: "create",
  calendar: policy.destination,
  idempotencyKey: mirrorIdempotencyKey(observation.identity, policy),
  content: normalizedContentOf(observation.event, policy),
  provenance: { kind: "ours", installation: policy.installation },
  precondition: { kind: "absent" },
});

const updateIntentFor = (
  event: RemoteEvent,
  mapping: Mapping,
  policy: ReconciliationPolicy,
): Extract<WriteIntent, { kind: "update" }> => ({
  kind: "update",
  calendar: policy.destination,
  target: mapping.destination.id,
  content: normalizedContentOf(event, policy),
  precondition: mapping.precondition,
});

const retireIntentFor = (
  mapping: Mapping,
  mirrors: MirrorIndex,
  policy: ReconciliationPolicy,
): Extract<WriteIntent, { kind: "delete" }> => ({
  kind: "delete",
  calendar: policy.destination,
  target: mirrors.byId.get(mapping.destination.id.value)?.deleteHandle ?? mapping.destination.deleteHandle,
  precondition: mapping.precondition,
  reason: "sourceUnmapped",
});

const writableIntoMirrorWindow = (event: RemoteEvent, policy: ReconciliationPolicy): boolean => {
  if (event.content.recurrence) {
    return true;
  }
  return policy.withinWindow(policy.mirrorWindow, event.content.time);
};

const supersededByTheBaseline = (event: RemoteEvent, baseline: KnownEvent): boolean =>
  !revisionOutranks(event.revision, baseline.revision) &&
  !sameSource(sourceFingerprintOf(event.fingerprint), baseline.sourceFingerprint);

const baselineFingerprintOf = (row: KnownEvent | undefined, mapping: Mapping): SourceFingerprint => {
  if (!row) {
    return mapping.sourceFingerprint;
  }
  return row.sourceFingerprint;
};

const conflictFor = (mapping: Mapping, event: RemoteEvent, mirror: RemoteEvent): Conflict => ({
  identity: mapping.sourceIdentity,
  cause: conflictCauseOf(mapping, event, mirror) ?? "mirrorContentChanged",
  expected: mapping.precondition,
  observed: observedPreconditionOf(mirror, mapping.precondition.kind),
});

const staleMappingConflict = (mapping: Mapping, baseline: KnownEvent): Conflict => ({
  identity: mapping.sourceIdentity,
  cause: "sourceChanged",
  expected: mapping.precondition,
  observed: { kind: "matchesFingerprint", fingerprint: baseline.sourceFingerprint.value },
});

const mirrorDivergedFromTheMapping = (mapping: Mapping, mirror: RemoteEvent): boolean =>
  !sameMirror(mirrorFingerprintOf(mirror.fingerprint), mapping.mirrorFingerprint);

const preconditionAlreadyStale = (mapping: Mapping, mirror: RemoteEvent): boolean =>
  !samePrecondition(
    mapping.precondition,
    observedPreconditionOf(mirror, mapping.precondition.kind),
  );

const mirrorIsNoLongerTheOneWeWrote = (mapping: Mapping, mirror: RemoteEvent): boolean =>
  preconditionAlreadyStale(mapping, mirror) || mirrorDivergedFromTheMapping(mapping, mirror);

const observedMirrorFor = (mapping: Mapping, input: WriteInput): RemoteEvent | null =>
  input.mirrors.byId.get(mapping.destination.id.value) ?? null;

const decideMappedWrite = (
  observation: IdentifiedEvent,
  mapping: Mapping,
  input: WriteInput,
): Decision => {
  const { event } = observation;
  const row = input.known.byIdentity.get(sourceIdentityKey(observation.identity));
  if (row && supersededByTheBaseline(event, row)) {
    return {
      kind: "unresolved",
      unresolved: { identity: observation.identity, id: event.id, reason: "staleRevision" },
    };
  }
  const mirror = observedMirrorFor(mapping, input);
  if (mirror && preconditionAlreadyStale(mapping, mirror)) {
    return { kind: "conflict", conflict: conflictFor(mapping, event, mirror) };
  }
  const baseline = baselineFingerprintOf(row, mapping);
  if (row && !sameSource(mapping.sourceFingerprint, baseline)) {
    return { kind: "conflict", conflict: staleMappingConflict(mapping, row) };
  }
  const unchanged = sameSource(sourceFingerprintOf(event.fingerprint), baseline);
  if (unchanged && mirror && mirrorDivergedFromTheMapping(mapping, mirror)) {
    return { kind: "conflict", conflict: conflictFor(mapping, event, mirror) };
  }
  if (unchanged) {
    return nothingToDo;
  }
  if (!writableIntoMirrorWindow(event, input.policy)) {
    return nothingToDo;
  }
  return {
    kind: "write",
    write: {
      kind: "single",
      at: startInstantOf(event),
      identity: observation.identity,
      intent: updateIntentFor(event, mapping, input.policy),
    },
  };
};

const shapeOfKnown = (row: KnownEvent): TimeShape => {
  if (row.recurring) {
    return "recurring";
  }
  return row.time.kind;
};

const representationChanged = (row: KnownEvent | undefined, event: RemoteEvent): boolean => {
  if (!row) {
    return false;
  }
  return shapeOfKnown(row) !== timeShapeOf(event);
};

const decideReassignedWrite = (reassignment: Reassignment, input: WriteInput): Decision => {
  const { mapping, observation } = reassignment;
  const mirror = observedMirrorFor(mapping, input);
  if (mirror && mirrorIsNoLongerTheOneWeWrote(mapping, mirror)) {
    return { kind: "conflict", conflict: conflictFor(mapping, observation.event, mirror) };
  }
  const settledRow = input.known.byIdentity.get(sourceIdentityKey(observation.identity));
  if (
    settledRow &&
    sameSource(sourceFingerprintOf(observation.event.fingerprint), settledRow.sourceFingerprint)
  ) {
    return nothingToDo;
  }
  if (!writableIntoMirrorWindow(observation.event, input.policy)) {
    return nothingToDo;
  }
  const retiredRow = input.known.byIdentity.get(sourceIdentityKey(mapping.sourceIdentity));
  if (representationChanged(retiredRow, observation.event)) {
    return {
      kind: "write",
      write: {
        kind: "replace",
        at: startInstantOf(observation.event),
        identity: mapping.sourceIdentity,
        retire: retireIntentFor(mapping, input.mirrors, input.policy),
        recreate: createIntentFor(observation, input.policy),
      },
    };
  }
  return {
    kind: "write",
    write: {
      kind: "single",
      at: startInstantOf(observation.event),
      identity: mapping.sourceIdentity,
      intent: updateIntentFor(observation.event, mapping, input.policy),
    },
  };
};

const decideCreate = (observation: IdentifiedEvent, input: WriteInput): Decision => {
  if (!writableIntoMirrorWindow(observation.event, input.policy)) {
    return nothingToDo;
  }
  return {
    kind: "write",
    write: {
      kind: "single",
      at: startInstantOf(observation.event),
      identity: observation.identity,
      intent: createIntentFor(observation, input.policy),
    },
  };
};

const writesOf = (decisions: readonly Decision[]): readonly PlannedWrite[] =>
  decisions.flatMap((decision) => {
    if (decision.kind !== "write") {
      return [];
    }
    return [decision.write];
  });

const conflictsOf = (decisions: readonly Decision[]): readonly Conflict[] =>
  decisions.flatMap((decision) => {
    if (decision.kind !== "conflict") {
      return [];
    }
    return [decision.conflict];
  });

const unresolvedOf = (decisions: readonly Decision[]): readonly Unresolved[] =>
  decisions.flatMap((decision) => {
    if (decision.kind !== "unresolved") {
      return [];
    }
    return [decision.unresolved];
  });

const mappedObservations = (input: WriteInput): readonly Decision[] =>
  input.observations.flatMap((observation) => {
    const mapping = input.indexes.bySourceIdentity.get(sourceIdentityKey(observation.identity));
    if (!mapping) {
      return [];
    }
    return [decideMappedWrite(observation, mapping, input)];
  });

const unmappedObservations = (input: WriteInput): readonly IdentifiedEvent[] =>
  input.observations.filter(
    (observation) => !input.indexes.bySourceIdentity.has(sourceIdentityKey(observation.identity)),
  );

const refusedPairingReported = (pairing: ReassignmentPairing): readonly Unresolved[] => {
  if (!pairing.refused) {
    return [];
  }
  return pairing.unpairedMappings.map((mapping) => ({
    identity: mapping.sourceIdentity,
    id: null,
    reason: "pairingCeilingExceeded",
  }));
};

const mappingsShieldedFromTombstoning = (pairing: ReassignmentPairing): readonly string[] => {
  const reassigned = pairing.reassignments.map((reassignment) =>
    sourceIdentityKey(reassignment.mapping.sourceIdentity),
  );
  if (!pairing.refused) {
    return reassigned;
  }
  return [
    ...reassigned,
    ...pairing.unpairedMappings.map((mapping) => sourceIdentityKey(mapping.sourceIdentity)),
  ];
};

const deriveWrites = (input: WriteInput): WriteDerivation => {
  const pairing = pairReassignedOccurrences(
    unmappedObservations(input),
    input.orphanedMappings,
    input.policy.limits,
  );
  const decisions = [
    ...mappedObservations(input),
    ...pairing.reassignments.map((reassignment) => decideReassignedWrite(reassignment, input)),
    ...pairing.unpairedObservations.map((observation) => decideCreate(observation, input)),
  ];
  return {
    writes: writesOf(decisions),
    conflicts: conflictsOf(decisions),
    unresolved: [...unresolvedOf(decisions), ...refusedPairingReported(pairing)],
    claimedMappingKeys: mappingsShieldedFromTombstoning(pairing),
  };
};

export { deriveWrites, mirrorIdempotencyKey };
export type { WriteDerivation, WriteInput };
