import type { Capabilities, ProviderId } from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../case-id";
import { capabilityCases } from "../cases/capabilities";
import { convergenceCases } from "../cases/convergence";
import { cursorCases } from "../cases/cursor";
import { deletionSafetyCases } from "../cases/deletion-safety";
import { diagnosticsCases } from "../cases/diagnostics";
import { hostileContentCases } from "../cases/hostile-content";
import { injectionCases } from "../cases/injection";
import { isolationCases } from "../cases/isolation";
import { lockupCases } from "../cases/lockups";
import { provenanceCases } from "../cases/provenance";
import { windowCases } from "../cases/window";
import { writeCases } from "../cases/writes";
import type { ConformanceCase } from "./case";

interface CaseSelection<Provider extends ProviderId = ProviderId> {
  readonly selected: readonly ConformanceCase<Provider>[];
}

const allCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  ...deletionSafetyCases(supports),
  ...isolationCases(supports),
  ...cursorCases(supports),
  ...writeCases(supports),
  ...provenanceCases(supports),
  ...windowCases(supports),
  ...capabilityCases(supports),
  ...diagnosticsCases(supports),
  ...convergenceCases(supports),
  ...hostileContentCases(supports),
  ...injectionCases(supports),
  ...lockupCases(supports),
];

const selectConformanceCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): CaseSelection<Provider> => ({ selected: allCases(supports) });

const conformanceCaseOf = <Provider extends ProviderId>(
  id: ConformanceCaseId,
  supports: Capabilities<Provider>,
): ConformanceCase<Provider> => {
  const found = allCases(supports).find((record) => record.id === id);
  if (!found) {
    throw new Error(`the conformance suite generates no case named "${id}"`);
  }
  return found;
};

export { allCases, conformanceCaseOf, selectConformanceCases };
export type { CaseSelection };
