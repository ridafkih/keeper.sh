import { describe, expect, it } from "vitest";
import { isDeleteApprovalApplicable } from "../../src/utils/delete-confirmation-policy";

describe("when approving deletions is an answer to anything", () => {
  it("accepts the answer while the question is whether the copies are gone", () => {
    expect(isDeleteApprovalApplicable("all_copies_missing")).toBe(true);
    expect(isDeleteApprovalApplicable("delete_breaker_tripped")).toBe(true);
    expect(isDeleteApprovalApplicable(null)).toBe(true);
  });

  /*
   * The pair paused because the destination answered, event by event, that the copies are
   * there. Recording an approval would delete originals whose copies exist and would exempt
   * the pair from the bulk-delete breaker for half an hour, in exchange for nothing.
   */
  it("refuses the answer when the destination still reports the copies", () => {
    expect(isDeleteApprovalApplicable("delete_probe_blocked")).toBe(false);
  });
});
