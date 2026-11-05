import type { Capabilities, ProviderId, WindowMembership } from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId, LedgerEntryId } from "../case-id";
import type { ConformanceEnvironment, ProviderUnderTest } from "../options";

interface CaseContext<Provider extends ProviderId = ProviderId> {
  readonly provider: ProviderUnderTest<Provider>;
  readonly environment: ConformanceEnvironment;
  readonly supports: Capabilities<Provider>;
  readonly withinWindow: WindowMembership;
}

type CaseGate =
  | { readonly kind: "ungated" }
  | { readonly kind: "branch"; readonly capability: keyof Capabilities; readonly branch: string };

interface ConformanceCase<Provider extends ProviderId = ProviderId> {
  readonly id: ConformanceCaseId;
  readonly title: string;
  readonly ledger: LedgerEntryId;
  readonly gate: CaseGate;
  readonly run: (context: CaseContext<Provider>) => Promise<void>;
}

type CaseFamily = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
) => readonly ConformanceCase<Provider>[];

export type { CaseContext, CaseFamily, CaseGate, ConformanceCase };
