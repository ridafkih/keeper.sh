import type { ConformanceCaseId, LedgerEntryId } from "./case-id";
import { ledgerEntryOf } from "./case-id";

interface ViolationDetail {
  readonly case: ConformanceCaseId;
  readonly ledger: LedgerEntryId;
  readonly message: string;
}

class ConformanceViolation extends Error {
  readonly case: ConformanceCaseId;
  readonly ledger: LedgerEntryId;

  constructor(detail: ViolationDetail) {
    super(`${detail.case} (${detail.ledger}): ${detail.message}`);
    this.name = "ConformanceViolation";
    this.case = detail.case;
    this.ledger = detail.ledger;
  }
}

const violated = (id: ConformanceCaseId, message: string): ConformanceViolation =>
  new ConformanceViolation({ case: id, ledger: ledgerEntryOf(id), message });

export { ConformanceViolation, violated };
export type { ViolationDetail };
