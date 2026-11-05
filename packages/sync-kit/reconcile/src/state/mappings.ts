import type { CalendarKey, ObservedPrecondition, RemoteRef } from "@keeper.sh/sync-protocol";
import { ReconcileInternalDataError } from "../errors";
import { calendarKeyString } from "../identity/calendar-key";
import type { MirrorFingerprint, SourceFingerprint } from "../identity/fingerprints";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey } from "../identity/source-identity";

interface Mapping {
  readonly sourceIdentity: SourceIdentity;
  readonly sourceCalendar: CalendarKey;
  readonly destination: RemoteRef;
  readonly destinationCalendar: CalendarKey;
  readonly sourceFingerprint: SourceFingerprint;
  readonly mirrorFingerprint: MirrorFingerprint;
  readonly precondition: ObservedPrecondition;
}

interface MappingSet {
  readonly entries: readonly Mapping[];
}

interface MappingIndexes {
  readonly bySourceIdentity: ReadonlyMap<string, Mapping>;
  readonly byDestinationId: ReadonlyMap<string, Mapping>;
}

const refuseDuplicateClaim = (key: string): never => {
  throw new ReconcileInternalDataError(`two mappings claim the source identity ${key}`);
};

const refuseForeignDestination = (key: string): never => {
  throw new ReconcileInternalDataError(
    `a mapping for the source identity ${key} points at a calendar other than the destination`,
  );
};

const indexBySourceIdentity = (
  mappings: MappingSet,
  destination: CalendarKey,
): ReadonlyMap<string, Mapping> => {
  const wanted = calendarKeyString(destination);
  const claimed = new Map<string, Mapping>();
  for (const entry of mappings.entries) {
    const key = sourceIdentityKey(entry.sourceIdentity);
    if (claimed.has(key)) {
      return refuseDuplicateClaim(key);
    }
    if (calendarKeyString(entry.destinationCalendar) !== wanted) {
      return refuseForeignDestination(key);
    }
    claimed.set(key, entry);
  }
  return claimed;
};

const indexMappings = (mappings: MappingSet, destination: CalendarKey): MappingIndexes => ({
  bySourceIdentity: indexBySourceIdentity(mappings, destination),
  byDestinationId: new Map(mappings.entries.map((entry) => [entry.destination.id.value, entry])),
});

export { indexMappings };
export type { Mapping, MappingIndexes, MappingSet };
