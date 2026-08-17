import type { BoundedSample, ListingDiagnostics, WithheldEvent } from "@keeper.sh/sync-protocol";
import { microsoftLimits } from "../limits";

interface DiagnosticsInputs {
  readonly withheld: readonly WithheldEvent[];
  readonly selfAuthored: readonly string[];
  readonly discarded: number;
  readonly pagesFetched: number;
}

const identifierOf = (entry: WithheldEvent): string => {
  if (entry.uid === null) {
    return entry.id.value;
  }
  return entry.uid.value;
};

const boundedSample = (identifiers: readonly string[]): BoundedSample => {
  const sample: string[] = [];
  const budget = { length: 0 };
  for (const identifier of identifiers) {
    if (sample.length >= microsoftLimits.diagnosticSampleEntries) {
      break;
    }
    if (budget.length + identifier.length > microsoftLimits.diagnosticSampleUtf16Length) {
      continue;
    }
    sample.push(identifier);
    budget.length += identifier.length;
  }
  return { sample, total: identifiers.length };
};

const totalledSample = (identifiers: readonly string[], total: number): BoundedSample => ({
  ...boundedSample(identifiers),
  total,
});

const unrepresentableIn = (withheld: readonly WithheldEvent[]): readonly WithheldEvent[] =>
  withheld.filter((entry) => entry.reason === "unrepresentableTime");

const listingDiagnostics = (inputs: DiagnosticsInputs): ListingDiagnostics => {
  const unrepresentable = unrepresentableIn(inputs.withheld);
  return {
    withheld: totalledSample(
      inputs.withheld.map((entry) => identifierOf(entry)),
      inputs.withheld.length + inputs.discarded,
    ),
    selfAuthored: boundedSample(inputs.selfAuthored),
    unrepresentable: boundedSample(unrepresentable.map((entry) => identifierOf(entry))),
    pagesFetched: inputs.pagesFetched,
  };
};

export { boundedSample, listingDiagnostics };
export type { DiagnosticsInputs };
