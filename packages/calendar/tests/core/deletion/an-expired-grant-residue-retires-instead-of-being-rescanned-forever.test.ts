import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  OAUTH_GRANT_RESIDUE_LIFETIME_MS,
} from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const RECORDED_AT = new Date("2026-08-26T10:30:00.000Z");

const expiredGrantRecord = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: new Date(RECORDED_AT.getTime() + OAUTH_GRANT_RESIDUE_LIFETIME_MS),
  id: "residue-grant-expired",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-expired",
});

const unexpiredGrantRecord = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + OAUTH_GRANT_RESIDUE_LIFETIME_MS),
  id: "residue-grant-live",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-live",
});

const createHarness = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const clearedIds: string[] = [];
  const attemptedIds: string[] = [];
  const observed: Record<string, unknown>[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      rows.delete(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows.values()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      attemptedIds.push(residueId);
      return Promise.reject(
        new Error(`residue ${residueId} must not spend a repair attempt in this test`),
      );
    },
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

  return { attemptedIds, clearedIds, observed, reap, rows };
};

describe("an expired grant residue retires instead of being rescanned forever", () => {
  it("retires the grant whose deferral window closed and leaves the live one skipped", async () => {
    const harness = createHarness([expiredGrantRecord(), unexpiredGrantRecord()]);

    const outcome = await harness.reap();

    expect(outcome.expiredIds).toEqual(["residue-grant-expired"]);
    expect(harness.clearedIds).toEqual(["residue-grant-expired"]);
    expect([...harness.rows.keys()]).toEqual(["residue-grant-live"]);

    expect(outcome.revocationSkippedIds).toEqual(["residue-grant-live"]);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.attemptedIds).toEqual([]);

    const fields = harness.observed[0] as Record<string, unknown>;
    const reasons = fields["teardown_residue.retirement_reasons"] as Record<
      string,
      string
    >;

    expect(reasons["residue-grant-expired"]).toBe("revocation_deferral_expired");
    expect(reasons["residue-grant-live"]).toBeUndefined();
  });
});
