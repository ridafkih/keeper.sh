import { describe, expect, it } from "vitest";
import { TWO_WAY_DELETE_APPROVAL_TTL_MS } from "@keeper.sh/constants";
import { resolveWriteBackPolicyState } from "../../../src/core/sync/write-back-policy";

const NOW = new Date("2027-05-01T12:00:00.000Z");
const MINUTE_MS = 60_000;

const resolve = (writeBackState: string, approvedAt: Date | null) =>
  resolveWriteBackPolicyState("edits_and_deletes", writeBackState, {
    approvedAt,
    now: NOW,
    ttlMs: TWO_WAY_DELETE_APPROVAL_TTL_MS,
  });

describe("resolveWriteBackPolicyState: the answer to a held deletion", () => {
  it("carries a fresh answer into the pass", () => {
    const approvedAt = new Date(NOW.getTime() - MINUTE_MS);

    expect(resolve("ok", approvedAt)).toEqual({
      deleteApproved: true,
      deleteApprovedAt: approvedAt,
      paused: false,
      writeBackMode: "edits_and_deletes",
    });
  });

  it("lets the answer expire rather than disarming the breaker forever", () => {
    const staleAt = new Date(NOW.getTime() - TWO_WAY_DELETE_APPROVAL_TTL_MS - MINUTE_MS);

    expect(resolve("ok", staleAt).deleteApproved).toBe(false);
  });

  it("carries no answer while the pair is still waiting for one", () => {
    expect(resolve("delete_confirmation_required", NOW)).toEqual({
      deleteApproved: false,
      deleteApprovedAt: null,
      paused: true,
      writeBackMode: "edits_and_deletes",
    });
  });

  it("carries no answer for a quarantined pair", () => {
    expect(resolve("quarantined", NOW)).toEqual({
      deleteApproved: false,
      deleteApprovedAt: null,
      paused: false,
      writeBackMode: "off",
    });
  });

  it("carries no answer when none was given", () => {
    expect(resolve("ok", null).deleteApproved).toBe(false);
  });
});
