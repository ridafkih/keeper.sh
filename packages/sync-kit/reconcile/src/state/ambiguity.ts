import type { SourceIdentity } from "../identity/source-identity";
import { sourceIdentityKey } from "../identity/source-identity";
import type { IdentifiedEvent } from "./dedupe";
import { rankOfRevision } from "./revision";

interface AmbiguityReport {
  readonly keys: ReadonlySet<string>;
  readonly identities: readonly SourceIdentity[];
}

const highestRankIn = (group: readonly IdentifiedEvent[]): number =>
  Math.max(
    Number.NEGATIVE_INFINITY,
    ...group.map((observation) => rankOfRevision(observation.event.revision)),
  );

const contentDiffersAtTheTop = (group: readonly IdentifiedEvent[]): boolean => {
  const best = highestRankIn(group);
  const contenders = group.filter(
    (observation) => rankOfRevision(observation.event.revision) === best,
  );
  return new Set(contenders.map((observation) => observation.event.fingerprint.value)).size > 1;
};

const ambiguousIdentities = (observations: readonly IdentifiedEvent[]): AmbiguityReport => {
  const grouped = Map.groupBy(observations, (observation) =>
    sourceIdentityKey(observation.identity),
  );
  const ambiguous = [...grouped.entries()].flatMap((entry) => {
    const [key, group] = entry;
    if (group.length < 2 || !contentDiffersAtTheTop(group)) {
      return [];
    }
    const first = group.at(0);
    if (!first) {
      return [];
    }
    return [{ key, identity: first.identity }];
  });
  return {
    keys: new Set(ambiguous.map((entry) => entry.key)),
    identities: ambiguous.map((entry) => entry.identity),
  };
};

export { ambiguousIdentities };
export type { AmbiguityReport };
