import { sourceIdentityKey } from "../identity/source-identity";
import type { PlanLimits } from "../policy";
import type { IdentifiedEvent } from "../state/dedupe";
import type { Mapping } from "../state/mappings";
import { compareText } from "./order";

interface Reassignment {
  readonly mapping: Mapping;
  readonly observation: IdentifiedEvent;
}

interface ReassignmentPairing {
  readonly reassignments: readonly Reassignment[];
  readonly unpairedObservations: readonly IdentifiedEvent[];
  readonly unpairedMappings: readonly Mapping[];
  readonly comparisons: number;
  readonly refused: boolean;
}

interface ComparisonTally {
  comparisons: number;
}

const sortedByKey = <Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string,
  tally: ComparisonTally,
): readonly Item[] =>
  items.toSorted((left, right) => {
    tally.comparisons += 1;
    return compareText(keyOf(left), keyOf(right));
  });

const pairWithinSeries = (
  observations: readonly IdentifiedEvent[],
  mappings: readonly Mapping[],
  tally: ComparisonTally,
): Omit<ReassignmentPairing, "comparisons" | "refused"> => {
  const orderedObservations = sortedByKey(
    observations,
    (observation) => sourceIdentityKey(observation.identity),
    tally,
  );
  const orderedMappings = sortedByKey(
    mappings,
    (mapping) => sourceIdentityKey(mapping.sourceIdentity),
    tally,
  );
  const width = Math.min(orderedObservations.length, orderedMappings.length);
  return {
    reassignments: orderedMappings.slice(0, width).flatMap((mapping, index) => {
      const observation = orderedObservations.at(index);
      if (!observation) {
        return [];
      }
      return [{ mapping, observation }];
    }),
    unpairedObservations: orderedObservations.slice(width),
    unpairedMappings: orderedMappings.slice(width),
  };
};

const nothingToPair = (
  observations: readonly IdentifiedEvent[],
  orphanedMappings: readonly Mapping[],
): boolean => observations.length === 0 || orphanedMappings.length === 0;

const beyondTheNamedWidth = (
  observations: readonly IdentifiedEvent[],
  orphanedMappings: readonly Mapping[],
  limits: PlanLimits,
): boolean => {
  if (nothingToPair(observations, orphanedMappings)) {
    return false;
  }
  return (
    observations.length > limits.reassignmentPairingWidth ||
    orphanedMappings.length > limits.reassignmentPairingWidth
  );
};

const pairReassignedOccurrences = (
  observations: readonly IdentifiedEvent[],
  orphanedMappings: readonly Mapping[],
  limits: PlanLimits,
): ReassignmentPairing => {
  if (beyondTheNamedWidth(observations, orphanedMappings, limits)) {
    return {
      reassignments: [],
      unpairedObservations: observations,
      unpairedMappings: orphanedMappings,
      comparisons: 0,
      refused: true,
    };
  }
  const tally: ComparisonTally = { comparisons: 0 };
  const observationsByUid = Map.groupBy(
    observations,
    (observation) => observation.identity.uid.value,
  );
  const mappingsByUid = Map.groupBy(orphanedMappings, (mapping) => mapping.sourceIdentity.uid.value);
  const series = [...new Set([...observationsByUid.keys(), ...mappingsByUid.keys()])].toSorted(
    compareText,
  );
  const paired = series.map((uid) =>
    pairWithinSeries(observationsByUid.get(uid) ?? [], mappingsByUid.get(uid) ?? [], tally),
  );
  return {
    reassignments: paired.flatMap((entry) => entry.reassignments),
    unpairedObservations: paired.flatMap((entry) => entry.unpairedObservations),
    unpairedMappings: paired.flatMap((entry) => entry.unpairedMappings),
    comparisons: tally.comparisons,
    refused: false,
  };
};

export { pairReassignedOccurrences };
export type { Reassignment, ReassignmentPairing };
