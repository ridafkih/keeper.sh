import { describe, expect, it } from "vitest";
import { resolveConfirmationDisposition } from "../../src/utils/delete-confirmation-policy";

const WAITING = "delete_confirmation_required";

/*
 * The dashboard withholding the button is not a gate: a stale client, a second tab and a
 * curl all reach this. The approval stamps deleteConfirmationApprovedAt, which releases the
 * hold on the ambiguous empty read AND exempts the pair from the bulk-delete breaker for
 * half an hour, so it has to be refused where the evidence for it does not exist.
 */
describe("approving deletions after a read that returned nothing at all", () => {
  it("refuses the approval while a blank read is the only evidence", () => {
    expect(resolveConfirmationDisposition("apply", {
      deletesUnlocked: false,
      destinationReachable: true,
      writeBackState: WAITING,
      writeBackStateReason: "all_copies_missing",
    })).toBe("not_applicable");
  });

  it("records the approval once a read has come back with something since", () => {
    expect(resolveConfirmationDisposition("apply", {
      deletesUnlocked: true,
      destinationReachable: true,
      writeBackState: WAITING,
      writeBackStateReason: "all_copies_missing",
    })).toBe("approve");
  });

  /*
   * The escape hatch for a destination the user really did empty runs through the breaker,
   * whose trip is observed against a read that returned items. Gating it too would close
   * the only route out.
   */
  it("still records the approval for a breaker trip", () => {
    expect(resolveConfirmationDisposition("apply", {
      deletesUnlocked: false,
      destinationReachable: true,
      writeBackState: WAITING,
      writeBackStateReason: "delete_breaker_tripped",
    })).toBe("approve");
  });
});

/*
 * The dispositions the twenty-four review rounds settled. None of them change.
 */
describe("the answers the gate must leave exactly as they were", () => {
  it("still refuses the approval while the destination reports the copies present", () => {
    expect(resolveConfirmationDisposition("apply", {
      deletesUnlocked: true,
      destinationReachable: true,
      writeBackState: WAITING,
      writeBackStateReason: "delete_probe_blocked",
    })).toBe("not_applicable");
  });

  it("still takes the answer that puts the copies back, gated or not", () => {
    expect(resolveConfirmationDisposition("decline", {
      deletesUnlocked: false,
      destinationReachable: true,
      writeBackState: WAITING,
      writeBackStateReason: "all_copies_missing",
    })).toBe("decline");
  });

  it("still refuses an approval for a pair that is not asking", () => {
    expect(resolveConfirmationDisposition("apply", {
      deletesUnlocked: true,
      destinationReachable: true,
      writeBackState: "quarantined",
      writeBackStateReason: "runaway_write_back",
    })).toBe("not_pending");
  });

  it("still ignores a decline for a pair that is not asking", () => {
    expect(resolveConfirmationDisposition("decline", {
      deletesUnlocked: true,
      destinationReachable: true,
      writeBackState: "quarantined",
      writeBackStateReason: "runaway_write_back",
    })).toBe("ignore");
  });
});
