import { describe, expect, it } from "vitest";
import { resolveDeleteConfirmationAnswers } from "@/lib/write-back-answers";

describe("what a paused pair can be answered with", () => {
  it("offers both answers while the question is whether the copies are really gone", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "all_copies_missing",
      state: "delete_confirmation_required",
    })).toEqual(["apply", "decline"]);

    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "delete_breaker_tripped",
      state: "delete_confirmation_required",
    })).toEqual(["apply", "decline"]);
  });

  /*
   * The copies are not gone: Keeper.sh asked the destination for them one by one and it
   * answered that they are there. Approving deletions on that evidence deletes originals
   * whose copies plainly exist, and the approval also exempts the pair from the bulk-delete
   * breaker for half an hour. There is no answer here but to stop asking.
   */
  it("offers no way to approve deletions the destination says are not gone", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "delete_probe_blocked",
      state: "delete_confirmation_required",
    })).toEqual(["decline"]);
  });

  it("offers nothing at all when the pair is not waiting on an answer", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "runaway_write_back",
      state: "quarantined",
    })).toEqual([]);
    expect(resolveDeleteConfirmationAnswers(null)).toEqual([]);
  });
});
