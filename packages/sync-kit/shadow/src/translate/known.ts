import type { CalendarKey } from "@keeper.sh/sync-protocol";
import type { CorruptKnownRow, KnownEvent, KnownState } from "@keeper.sh/sync-reconcile";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { MirrorRow, StoredSourceEvent } from "../input/destination-sync-input";
import { byTextAscending } from "../catalog/order";
import type { DecodeStoredEvent } from "./decode";

interface KnownStateRequest {
  readonly sourceCalendar: CalendarKey;
  readonly mirrors: readonly MirrorRow[];
  readonly storedSourceEvents: readonly StoredSourceEvent[];
  readonly decodeStored: DecodeStoredEvent;
}

const mirrorsSharingTheUid = (
  mirrors: readonly MirrorRow[],
  stored: StoredSourceEvent,
): readonly MirrorRow[] =>
  mirrors.filter((mirror) => mirror.sourceIdentity.uid.value === stored.uid.value);

const mirrorOfTheSameRemoteId = (
  candidates: readonly MirrorRow[],
  stored: StoredSourceEvent,
): MirrorRow | null =>
  candidates.find((mirror) => mirror.sourceRemoteId.value === stored.id.value) ?? null;

const theOnlyMirrorSharingTheUid = (candidates: readonly MirrorRow[]): MirrorRow | null => {
  if (candidates.length !== 1) {
    return null;
  }
  return candidates.at(0) ?? null;
};

const unambiguousMirrorOf = (
  stored: StoredSourceEvent,
  mirrors: readonly MirrorRow[],
): MirrorRow | null => {
  const candidates = mirrorsSharingTheUid(mirrors, stored);
  return mirrorOfTheSameRemoteId(candidates, stored) ?? theOnlyMirrorSharingTheUid(candidates);
};

const corruptRowOf = (stored: StoredSourceEvent, mirrors: readonly MirrorRow[]): CorruptKnownRow => {
  const mirroredBy = unambiguousMirrorOf(stored, mirrors);
  if (!mirroredBy) {
    return { id: stored.id, uid: stored.uid };
  }
  return { id: mirroredBy.sourceRemoteId, uid: stored.uid };
};

const unreadableStoredRows = (request: KnownStateRequest): readonly StoredSourceEvent[] =>
  request.storedSourceEvents.filter(
    (stored) => request.decodeStored(stored.canonical).kind === "corrupt",
  );

const knownEventOf = (mirror: MirrorRow): KnownEvent => ({
  identity: mirror.sourceIdentity,
  remoteId: mirror.sourceRemoteId,
  sourceFingerprint: mirror.sourceFingerprint,
  revision: mirror.sourceRevision,
  time: mirror.mirroredTime,
  recurring: mirror.mirroredRecurring,
  sourceCalendar: mirror.sourceCalendar,
});

const readableMirrors = (
  mirrors: readonly MirrorRow[],
  unreadable: readonly StoredSourceEvent[],
): readonly MirrorRow[] => {
  const unreadableUids = new Set(unreadable.map((stored) => stored.uid.value));
  return mirrors.filter((mirror) => !unreadableUids.has(mirror.sourceIdentity.uid.value));
};

const inIdentityOrder = (events: readonly KnownEvent[]): readonly KnownEvent[] =>
  events.toSorted((left, right) =>
    byTextAscending(sourceIdentityKey(left.identity), sourceIdentityKey(right.identity)),
  );

const buildKnownState = (request: KnownStateRequest): KnownState => {
  const unreadable = unreadableStoredRows(request);
  return {
    calendar: request.sourceCalendar,
    events: inIdentityOrder(
      readableMirrors(request.mirrors, unreadable).map((mirror) => knownEventOf(mirror)),
    ),
    corrupt: unreadable.map((stored) => corruptRowOf(stored, request.mirrors)),
  };
};

export { buildKnownState };
export type { KnownStateRequest };
