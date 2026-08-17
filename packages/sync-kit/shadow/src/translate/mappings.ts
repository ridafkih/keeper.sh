import type { CalendarKey } from "@keeper.sh/sync-protocol";
import type { Mapping, MappingSet } from "@keeper.sh/sync-reconcile";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { MirrorRow } from "../input/destination-sync-input";
import { byTextAscending } from "../catalog/order";

interface MappingSetRequest {
  readonly sourceCalendar: CalendarKey;
  readonly mirrors: readonly MirrorRow[];
}

const mappingOf = (mirror: MirrorRow): Mapping => ({
  sourceIdentity: mirror.sourceIdentity,
  sourceCalendar: mirror.sourceCalendar,
  destination: mirror.destination,
  destinationCalendar: mirror.destinationCalendar,
  sourceFingerprint: mirror.sourceFingerprint,
  mirrorFingerprint: mirror.mirrorFingerprint,
  precondition: mirror.precondition,
});

const inIdentityOrder = (entries: readonly Mapping[]): readonly Mapping[] =>
  entries.toSorted((left, right) =>
    byTextAscending(sourceIdentityKey(left.sourceIdentity), sourceIdentityKey(right.sourceIdentity)),
  );

const buildMappingSet = (request: MappingSetRequest): MappingSet => ({
  entries: inIdentityOrder(request.mirrors.map(mappingOf)),
});

export { buildMappingSet };
export type { MappingSetRequest };
