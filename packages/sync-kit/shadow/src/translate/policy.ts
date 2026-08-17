import type { ProvenCoverage, ReconciliationPolicy } from "@keeper.sh/sync-reconcile";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import type { DestinationSyncInput } from "../input/destination-sync-input";
import type { SourceCoverageProof } from "../input/stored-coverage";
import type { ShadowOptions } from "../options";

interface PolicyRequest {
  readonly input: DestinationSyncInput;
  readonly proofs: readonly SourceCoverageProof[];
  readonly options: ShadowOptions;
}

const provenCoverageOf = (proof: SourceCoverageProof): ProvenCoverage => {
  if (proof.kind === "unproven") {
    return { kind: "unproven" };
  }
  return proof.coverage;
};

const coverageBySourceOf = (
  proofs: readonly SourceCoverageProof[],
): ReadonlyMap<string, ProvenCoverage> =>
  new Map(proofs.map((proof) => [calendarKeyString(proof.calendar), provenCoverageOf(proof)]));

const buildPolicy = (request: PolicyRequest): ReconciliationPolicy => ({
  installation: request.input.installation,
  destination: request.input.destination,
  capabilities: request.input.capabilities,
  mirrorWindow: request.input.mirrorWindow,
  coverageBySource: coverageBySourceOf(request.proofs),
  withinWindow: request.options.withinWindow,
  limits: request.options.planLimits,
});

export { buildPolicy };
export type { PolicyRequest };
