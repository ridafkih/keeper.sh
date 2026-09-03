import type { ConformanceCaseId, LedgerEntryId } from "./case-id";
import { ungatedCaseIdsOf } from "./registry/gates";

interface SelectedCase {
  readonly id: ConformanceCaseId;
  readonly title: string;
  readonly ledger: LedgerEntryId;
  readonly branch: string | null;
}

interface ConformanceReport {
  readonly name: string;
  readonly selected: readonly SelectedCase[];
  readonly ungated: readonly ConformanceCaseId[];
}

const ungatedCaseIds: readonly ConformanceCaseId[] = ungatedCaseIdsOf();

export { ungatedCaseIds };
export type { ConformanceReport, SelectedCase };
