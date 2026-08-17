import type {
  CalendarKey,
  EventTime,
  EventUid,
  RemoteEventId,
  Revision,
} from "@keeper.sh/sync-protocol";
import type { SourceFingerprint } from "../identity/fingerprints";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey } from "../identity/source-identity";

interface KnownEvent {
  readonly identity: SourceIdentity;
  readonly remoteId: RemoteEventId;
  readonly sourceFingerprint: SourceFingerprint;
  readonly revision: Revision;
  readonly time: EventTime;
  readonly recurring: boolean;
  readonly sourceCalendar: CalendarKey;
}

interface CorruptKnownRow {
  readonly id: RemoteEventId;
  readonly uid: EventUid | null;
}

interface KnownState {
  readonly calendar: CalendarKey;
  readonly events: readonly KnownEvent[];
  readonly corrupt: readonly CorruptKnownRow[];
}

interface KnownIndex {
  readonly byIdentity: ReadonlyMap<string, KnownEvent>;
  readonly byUid: ReadonlyMap<string, readonly KnownEvent[]>;
  readonly byRemoteId: ReadonlyMap<string, KnownEvent>;
}

const indexKnownEvents = (known: KnownState): KnownIndex => ({
  byIdentity: new Map(known.events.map((event) => [sourceIdentityKey(event.identity), event])),
  byUid: Map.groupBy(known.events, (event) => event.identity.uid.value),
  byRemoteId: new Map(known.events.map((event) => [event.remoteId.value, event])),
});

export { indexKnownEvents };
export type { CorruptKnownRow, KnownEvent, KnownIndex, KnownState };
