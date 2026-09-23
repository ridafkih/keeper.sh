import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey } from "../identity/source-identity";
import { compareNumbers, compareText } from "../plan/order";
import { rankOfRevision } from "./revision";

interface IdentifiedEvent {
  readonly identity: SourceIdentity;
  readonly event: RemoteEvent;
}

interface DedupedObservations {
  readonly kept: readonly IdentifiedEvent[];
  readonly supersededKeys: readonly string[];
  readonly comparisons: number;
}

const compareObservedRevisions = (left: RemoteEvent, right: RemoteEvent): number => {
  const leftRank = rankOfRevision(left.revision);
  const rightRank = rankOfRevision(right.revision);
  if (leftRank !== rightRank) {
    return compareNumbers(leftRank, rightRank);
  }
  return compareText(left.fingerprint.value, right.fingerprint.value);
};

const dedupeObservations = (observations: readonly IdentifiedEvent[]): DedupedObservations => {
  const winners = new Map<string, IdentifiedEvent>();
  const supersededKeys: string[] = [];
  for (const observation of observations) {
    const key = sourceIdentityKey(observation.identity);
    const incumbent = winners.get(key);
    if (!incumbent) {
      winners.set(key, observation);
      continue;
    }
    supersededKeys.push(key);
    if (compareObservedRevisions(observation.event, incumbent.event) > 0) {
      winners.set(key, observation);
    }
  }
  /*
   * Every superseded key is exactly one comparison against the incumbent, so the count the
   * operation-count tests assert is the length of that list rather than a separate tally.
   */
  return { kept: [...winners.values()], supersededKeys, comparisons: supersededKeys.length };
};

export { compareObservedRevisions, dedupeObservations };
export type { DedupedObservations, IdentifiedEvent };
