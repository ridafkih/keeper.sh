import type { ChangeListing, RemoteEvent, WithheldEvent } from "@keeper.sh/sync-protocol";
import { observedSourceIdentity } from "../identity/observed-identity";
import { sourceIdentityKey, uidPresenceKey } from "../identity/source-identity";

interface PresenceBasis {
  readonly presentKeys: ReadonlySet<string>;
  readonly withheldKeys: ReadonlySet<string>;
}

const presenceKeyOfEvent = (event: RemoteEvent): readonly string[] => {
  const identity = observedSourceIdentity(event);
  if (identity) {
    return [sourceIdentityKey(identity)];
  }
  if (event.uid.value.length === 0) {
    return [];
  }
  return [uidPresenceKey(event.uid)];
};

const presenceKeyOfWithheld = (withheld: WithheldEvent): readonly string[] => {
  if (!withheld.uid) {
    return [];
  }
  return [uidPresenceKey(withheld.uid)];
};

const presenceBasis = (listing: ChangeListing): PresenceBasis => {
  const observed = (listing.events ?? []).flatMap((event) => presenceKeyOfEvent(event));
  const withheld = (listing.withheld ?? []).flatMap((event) => presenceKeyOfWithheld(event));
  return { presentKeys: new Set([...observed, ...withheld]), withheldKeys: new Set(withheld) };
};

const withShieldedKeys = (basis: PresenceBasis, shielded: readonly string[]): PresenceBasis => ({
  presentKeys: new Set([...basis.presentKeys, ...shielded]),
  withheldKeys: basis.withheldKeys,
});

export { presenceBasis, withShieldedKeys };
export type { PresenceBasis };
