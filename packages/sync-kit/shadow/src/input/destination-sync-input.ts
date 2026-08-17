import type {
  CalendarKey,
  Capabilities,
  ChangeListing,
  DeleteHandle,
  EventTime,
  EventUid,
  Fingerprint,
  InstallationId,
  ObservedPrecondition,
  Provenance,
  ProviderId,
  RemoteEventId,
  RemoteRef,
  RemoteVersion,
  Revision,
  TimeWindow,
  WritableCalendar,
} from "@keeper.sh/sync-protocol";
import type {
  MirrorFingerprint,
  SourceFingerprint,
  SourceIdentity,
} from "@keeper.sh/sync-reconcile";
import type { LocalReadCompleteness } from "./read-completeness";
import type { SourceReadWitness } from "./read-witness";
import type { StoredSourceCoverage } from "./stored-coverage";

interface DestinationNormalizationWitness {
  readonly appliedBy: "caller";
  readonly provider: ProviderId;
}

interface StoredSourceEvent {
  readonly sourceCalendar: CalendarKey;
  readonly id: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly uid: EventUid;
  readonly revision: Revision;
  readonly version: RemoteVersion;
  readonly fingerprint: Fingerprint;
  readonly provenance: Provenance;
  readonly canonical: unknown;
  readonly time: EventTime;
  readonly recurring: boolean;
}

interface MirrorRow {
  readonly sourceCalendar: CalendarKey;
  readonly sourceIdentity: SourceIdentity;
  readonly sourceRemoteId: RemoteEventId;
  readonly sourceFingerprint: SourceFingerprint;
  readonly sourceRevision: Revision;
  readonly mirroredTime: EventTime;
  readonly mirroredRecurring: boolean;
  readonly destination: RemoteRef;
  readonly destinationCalendar: CalendarKey;
  readonly mirrorFingerprint: MirrorFingerprint;
  readonly precondition: ObservedPrecondition;
}

interface DestinationSyncInput {
  readonly installation: InstallationId;
  readonly destination: WritableCalendar;
  readonly capabilities: Capabilities;
  readonly mirrorWindow: TimeWindow;
  readonly mappedSourceCalendars: readonly CalendarKey[];
  readonly storedSourceEvents: readonly StoredSourceEvent[];
  readonly mirrors: readonly MirrorRow[];
  readonly destinationListing: ChangeListing;
  readonly storedCoverage: readonly StoredSourceCoverage[];
  readonly completeness: LocalReadCompleteness;
  readonly witness: SourceReadWitness;
  readonly normalization: DestinationNormalizationWitness;
}

export type {
  DestinationNormalizationWitness,
  DestinationSyncInput,
  MirrorRow,
  StoredSourceEvent,
};
