import type { ObservedPrecondition, RemoteEvent } from "@keeper.sh/sync-protocol";
import { joinOnNul } from "../identity/nul";
import {
  mirrorFingerprintOf,
  sameMirror,
  sameSource,
  sourceFingerprintOf,
} from "../identity/fingerprints";
import { boundsOfTime } from "../state/event-shape";
import type { Mapping } from "../state/mappings";
import type { Conflict, ConflictCause } from "./plan";
import { observedPreconditionOf } from "./preconditions";

const timeSignatureOf = (event: RemoteEvent): string => {
  if (event.content.recurrence) {
    return joinOnNul(["recurring", event.content.recurrence.value]);
  }
  const bounds = boundsOfTime(event.content.time);
  return joinOnNul([event.content.time.kind, bounds.start.value, bounds.end.value]);
};

const divergedMirrorCause = (
  observedSource: RemoteEvent | null,
  observedMirror: RemoteEvent,
): ConflictCause => {
  if (!observedSource) {
    return "mirrorContentChanged";
  }
  if (timeSignatureOf(observedMirror) !== timeSignatureOf(observedSource)) {
    return "mirrorTimeChanged";
  }
  if (observedMirror.content.availability !== observedSource.content.availability) {
    return "mirrorAvailabilityChanged";
  }
  return "mirrorContentChanged";
};

const conflictCauseOf = (
  mapping: Mapping,
  observedSource: RemoteEvent | null,
  observedMirror: RemoteEvent | null,
): ConflictCause | null => {
  if (!observedMirror) {
    return "mirrorMissing";
  }
  if (observedMirror.id.value !== mapping.destination.id.value) {
    return "mirrorReassigned";
  }
  if (!sameMirror(mirrorFingerprintOf(observedMirror.fingerprint), mapping.mirrorFingerprint)) {
    return divergedMirrorCause(observedSource, observedMirror);
  }
  if (
    observedSource &&
    !sameSource(sourceFingerprintOf(observedSource.fingerprint), mapping.sourceFingerprint)
  ) {
    return "sourceChanged";
  }
  return null;
};

const observedSideOf = (
  mapping: Mapping,
  observedMirror: RemoteEvent | null,
): ObservedPrecondition => {
  if (!observedMirror) {
    return mapping.precondition;
  }
  return observedPreconditionOf(observedMirror, mapping.precondition.kind);
};

const classifyConflict = (
  mapping: Mapping,
  observedSource: RemoteEvent | null,
  observedMirror: RemoteEvent | null,
): Conflict | null => {
  const cause = conflictCauseOf(mapping, observedSource, observedMirror);
  if (!cause) {
    return null;
  }
  return {
    identity: mapping.sourceIdentity,
    cause,
    expected: mapping.precondition,
    observed: observedSideOf(mapping, observedMirror),
  };
};

export { classifyConflict, conflictCauseOf };
