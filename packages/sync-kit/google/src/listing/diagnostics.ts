import type { BoundedSample, ListingDiagnostics, WithheldEvent } from "@keeper.sh/sync-protocol";
import { googleListingLimits } from "../limits";

interface DiagnosticsInput {
  readonly withheld: readonly WithheldEvent[];
  readonly unnamedDiscards: number;
  readonly selfAuthored: readonly string[];
  readonly pagesFetched: number;
}

const identifierOf = (entry: WithheldEvent): string => {
  if (entry.uid === null) {
    return entry.id.value;
  }
  return entry.uid.value;
};

const boundedSample = (identifiers: readonly string[], total: number): BoundedSample => {
  const sample: string[] = [];
  const budget = { length: 0 };
  for (const identifier of identifiers) {
    if (sample.length >= googleListingLimits.diagnosticSampleEntries) {
      break;
    }
    if (budget.length + identifier.length > googleListingLimits.diagnosticSampleUtf16Length) {
      continue;
    }
    sample.push(identifier);
    budget.length += identifier.length;
  }
  return { sample, total };
};

const unrepresentableIn = (withheld: readonly WithheldEvent[]): readonly WithheldEvent[] =>
  withheld.filter((entry) => entry.reason === "unrepresentableTime");

const listingDiagnostics = (input: DiagnosticsInput): ListingDiagnostics => {
  const unrepresentable = unrepresentableIn(input.withheld);
  return {
    withheld: boundedSample(
      input.withheld.map((entry) => identifierOf(entry)),
      input.withheld.length + input.unnamedDiscards,
    ),
    selfAuthored: boundedSample(input.selfAuthored, input.selfAuthored.length),
    unrepresentable: boundedSample(
      unrepresentable.map((entry) => identifierOf(entry)),
      unrepresentable.length,
    ),
    pagesFetched: input.pagesFetched,
  };
};

export { boundedSample, listingDiagnostics };
export type { DiagnosticsInput };
