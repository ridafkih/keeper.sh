import type { CatalogCaveat } from "../catalog/entries";
import type { DestinationSyncInput } from "../input/destination-sync-input";
import { readIsComplete } from "../input/read-completeness";
import type { SourceCoverageProof } from "../input/stored-coverage";
import { sourceCoverageFrom } from "../input/stored-coverage";
import type { ShadowOptions } from "../options";
import type { DecodeStoredEvent } from "./decode";
import { decodeStoredCanonicalEvent } from "./decode";
import { refusalFor } from "./guards";
import { buildKnownState } from "./known";
import { synthesizeSourceListing } from "./listing";
import { buildMappingSet } from "./mappings";
import { buildObservedState } from "./observed";
import { partitionBySourceCalendar } from "./partition";
import type { SourcePartition } from "./partition";
import { buildPolicy } from "./policy";
import type { Translation, TranslationUnit } from "./unit";

interface ProvenPartition {
  readonly partition: SourcePartition;
  readonly proof: SourceCoverageProof;
}

const proofFor = (
  partition: SourcePartition,
  input: DestinationSyncInput,
  options: ShadowOptions,
): SourceCoverageProof => {
  if (!partition.storedCoverage) {
    return {
      kind: "unproven",
      calendar: partition.sourceCalendar,
      refusal: "noRecordedIngestWindow",
    };
  }
  if (!readIsComplete(input.completeness)) {
    return {
      kind: "unproven",
      calendar: partition.sourceCalendar,
      refusal: "localReadIncomplete",
    };
  }
  return sourceCoverageFrom({
    stored: partition.storedCoverage,
    mirrorWindow: input.mirrorWindow,
    asOf: options.asOf,
    maxCoverageAgeSeconds: options.maxCoverageAgeSeconds,
  });
};

const downgradedBySibling = (proven: ProvenPartition): ProvenPartition => {
  if (proven.proof.kind === "unproven") {
    return proven;
  }
  return {
    partition: proven.partition,
    proof: {
      kind: "unproven",
      calendar: proven.proof.calendar,
      refusal: "siblingSourceUnproven",
    },
  };
};

const provenPartitions = (
  partitions: readonly SourcePartition[],
  input: DestinationSyncInput,
  options: ShadowOptions,
): readonly ProvenPartition[] => {
  const proven = partitions.map((partition) => ({
    partition,
    proof: proofFor(partition, input, options),
  }));
  if (proven.every((entry) => entry.proof.kind === "proven")) {
    return proven;
  }
  return proven.map((entry) => downgradedBySibling(entry));
};

const whenTrue = <Item>(condition: boolean, items: readonly Item[]): readonly Item[] => {
  if (!condition) {
    return [];
  }
  return items;
};

const stalenessCaveats: readonly CatalogCaveat[] = ["coverageStalerThanTheLiveEngineAccepts"];

const underReportCaveats: readonly CatalogCaveat[] = ["underReportsRelativeToLiveEngine"];

const crossSourceCaveats: readonly CatalogCaveat[] = ["crossSourceInteractionsInvisible"];

const recordingWasTooOld = (proven: readonly ProvenPartition[]): boolean =>
  proven.some(
    (entry) => entry.proof.kind === "unproven" && entry.proof.refusal === "recordingTooOld",
  );

const anySourceIsUnproven = (proven: readonly ProvenPartition[]): boolean =>
  proven.some((entry) => entry.proof.kind === "unproven");

const caveatsFor = (proven: readonly ProvenPartition[]): readonly CatalogCaveat[] => [
  "mirrorWindowRetirementSuppressed",
  "noSourceRemovalSignal",
  ...whenTrue(recordingWasTooOld(proven), stalenessCaveats),
  ...whenTrue(anySourceIsUnproven(proven), underReportCaveats),
  ...whenTrue(proven.length > 1, crossSourceCaveats),
];

const unitOf = (
  proven: ProvenPartition,
  input: DestinationSyncInput,
  policy: TranslationUnit["policy"],
  decodeStored: DecodeStoredEvent,
): TranslationUnit => ({
  sourceCalendar: proven.partition.sourceCalendar,
  observed: buildObservedState({
    source: synthesizeSourceListing({
      sourceCalendar: proven.partition.sourceCalendar,
      mirrorWindow: input.mirrorWindow,
      storedSourceEvents: proven.partition.storedSourceEvents,
      completeness: input.completeness,
      proof: proven.proof,
      decodeStored,
    }),
    destination: input.destinationListing,
  }),
  known: buildKnownState({
    sourceCalendar: proven.partition.sourceCalendar,
    mirrors: proven.partition.mirrors,
    storedSourceEvents: proven.partition.storedSourceEvents,
    decodeStored,
  }),
  mappings: buildMappingSet({
    sourceCalendar: proven.partition.sourceCalendar,
    mirrors: proven.partition.mirrors,
  }),
  policy,
  proof: proven.proof,
});

const translateDestinationSync = (
  input: DestinationSyncInput,
  options: ShadowOptions,
): Translation => {
  const destination = input.destination.key;
  const refused = refusalFor(input, options);
  if (refused) {
    return { kind: "refused", destination, reason: refused.reason, detail: refused.detail };
  }
  const proven = provenPartitions(
    partitionBySourceCalendar({
      mappedSourceCalendars: input.mappedSourceCalendars,
      storedSourceEvents: input.storedSourceEvents,
      mirrors: input.mirrors,
      storedCoverage: input.storedCoverage,
    }),
    input,
    options,
  );
  const policy = buildPolicy({
    input,
    proofs: proven.map((entry) => entry.proof),
    options,
  });
  return {
    kind: "translated",
    destination,
    units: proven.map((entry) => unitOf(entry, input, policy, decodeStoredCanonicalEvent)),
    caveats: caveatsFor(proven),
  };
};

export { translateDestinationSync };
