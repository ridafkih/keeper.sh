import { describe, expect, it } from "vitest";
import {
  resolveDestinationAttemptVerdict,
  type DestinationOperationCounts,
} from "../src/destination-errors";

const unattempted: DestinationOperationCounts = {
  added: 0,
  addFailed: 0,
  conflictsResolved: 0,
  removed: 0,
  removeFailed: 0,
};

describe("the verdict for a run the deletion tombstone aborted", () => {
  it("is inconclusive, never succeeded, when nothing was attempted", () => {
    expect(resolveDestinationAttemptVerdict(unattempted, false, true)).toBe("inconclusive");
  });

  it("is inconclusive even when the abort landed after some operations went through", () => {
    const partial: DestinationOperationCounts = { ...unattempted, added: 50 };

    expect(resolveDestinationAttemptVerdict(partial, false, true)).toBe("inconclusive");
  });

  it("leaves an ordinary unattempted non-superseded run on its current verdict", () => {
    expect(resolveDestinationAttemptVerdict(unattempted, false, false)).toBe("succeeded");
    expect(resolveDestinationAttemptVerdict(unattempted, false)).toBe("succeeded");
  });
});
