import { describe, expect, it } from "vitest";
import { resolveDeleteConfirmationAnswers } from "@/lib/write-back-answers";

const WAITING = "delete_confirmation_required";

/*
 * A blank read has two causes and the code cannot tell them apart: the copies were deleted,
 * or the connection, the calendar id or the provider is broken. "Delete the originals" is
 * only an answer to the first, and it authorises irreversible deletions on a real calendar,
 * so it is not offered while a blank read is the only evidence there is. What clears the
 * bar is a read that came back with at least one item after the copies went missing — that
 * proves the credential works AND that the calendar id still points at the right calendar,
 * which reconnecting on its own does not.
 */
describe("what a pair paused on a blank read can be answered with", () => {
  it("never offers the plain deletion on the strength of a blank read alone", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: false,
      reason: "all_copies_missing",
      state: WAITING,
    })).not.toContain("apply");
  });

  /*
   * A destination calendar holding nothing but the copies can never produce a read that
   * comes back with one, so the reading-based route is shut to it for good. The answer it
   * gets instead asserts what Keeper.sh could not see — that the user emptied it — in its
   * own words, and the server refuses it while the destination is one it already knows it
   * cannot read.
   */
  it("offers the user's own word as a separate answer instead", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: false,
      reason: "all_copies_missing",
      state: WAITING,
    })).toEqual(["decline", "apply_empty_destination"]);
  });

  it("offers the deletion once a read has come back with something since", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "all_copies_missing",
      state: WAITING,
    })).toEqual(["apply", "decline"]);
  });

  /*
   * A breaker trip is observed against a read that returned items, so the evidence the
   * blank-read gate asks for is already in hand and gating this reason would withhold the
   * answer for no gain.
   */
  it("still offers the deletion for a breaker trip, gated or not", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: false,
      reason: "delete_breaker_tripped",
      state: WAITING,
    })).toEqual(["apply", "decline"]);
  });

  it("still refuses the deletion while the destination reports the copies present", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "delete_probe_blocked",
      state: WAITING,
    })).toEqual(["decline"]);
  });

  it("still offers nothing at all when the pair is not waiting on an answer", () => {
    expect(resolveDeleteConfirmationAnswers({
      deletesUnlocked: true,
      reason: "runaway_write_back",
      state: "quarantined",
    })).toEqual([]);
    expect(resolveDeleteConfirmationAnswers(null)).toEqual([]);
  });
});
