import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const ONE_HOUR_MS = 60 * 60 * 1000;
const RECORDED_AT = new Date("2026-08-26T11:45:00.000Z");

const grantRecord = (id: string, userId: string): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: new Date(NOW.getTime() + ONE_HOUR_MS),
  id,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId,
});

const createHarness = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const observed: Record<string, unknown>[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      rows.delete(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows.values()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) =>
      Promise.reject(
        new Error(`residue ${residueId} must not spend a repair attempt in this test`),
      ),
  };

  const reap = createTeardownResidueReaper({
    createRegistrarContext: () =>
      Promise.reject(new Error("push registration is not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: () => undefined,
    repairDeadlineMs: 5000,
    residue: store,
    resolveRegistrar: () => null,
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { observed, reap };
};

describe("the skipped grant names the row it left behind", () => {
  it("emits the skipped residue ids and their user ids on the same wide event as the count", async () => {
    const harness = createHarness([
      grantRecord("residue-grant-a", "user-alpha"),
      grantRecord("residue-grant-b", "user-beta"),
    ]);

    await harness.reap();

    expect(harness.observed).toHaveLength(1);

    const fields = harness.observed[0] as Record<string, unknown>;

    expect(fields["teardown_residue.revocation_skipped_count"]).toBe(2);
    expect(fields["teardown_residue.scanned_count"]).toBe(2);
    expect(fields["teardown_residue.cleared_count"]).toBe(0);
    expect(fields["teardown_residue.failed_count"]).toBe(0);
    expect(fields["teardown_residue.expired_count"]).toBe(0);

    const skippedIds = fields["teardown_residue.revocation_skipped_ids"];
    const skippedUserIds = fields["teardown_residue.revocation_skipped_user_ids"];

    expect(Array.isArray(skippedIds) ? [...(skippedIds as string[])].sort() : skippedIds)
      .toEqual(["residue-grant-a", "residue-grant-b"]);
    expect(
      Array.isArray(skippedUserIds)
        ? [...(skippedUserIds as string[])].sort()
        : skippedUserIds,
    ).toEqual(["user-alpha", "user-beta"]);
  });
});
