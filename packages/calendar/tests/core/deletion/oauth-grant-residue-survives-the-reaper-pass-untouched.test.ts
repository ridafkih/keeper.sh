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

const grantRecord = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: new Date(NOW.getTime() + ONE_HOUR_MS),
  id: "residue-grant",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-grant",
});

const createHarness = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const clearedIds: string[] = [];
  const attemptsSpent: string[] = [];

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
      attemptsSpent.push(residueId);

      const claimed = rows.get(residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      const spent = (claimed.attempts ?? 0) + 1;

      rows.set(residueId, { ...claimed, attempts: spent });

      return Promise.resolve(spent);
    },
  };

  const reap = createTeardownResidueReaper({
    createRegistrarContext: () =>
      Promise.reject(new Error("push registration is not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    repairDeadlineMs: 5000,
    residue: store,
    resolveRegistrar: () => null,
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { attemptsSpent, clearedIds, reap, rows };
};

describe("oauth grant residue survives the reaper pass untouched", () => {
  it("leaves a live grant row in the store, spends no attempt on it, and reports it as revocation skipped rather than cleared", async () => {
    const harness = createHarness([grantRecord()]);

    const outcome = await harness.reap();

    expect(harness.attemptsSpent).toEqual([]);
    expect(harness.rows.get("residue-grant")?.attempts).toBe(0);
    expect([...harness.rows.keys()]).toEqual(["residue-grant"]);
    expect(harness.clearedIds).toEqual([]);
    expect(outcome.revocationSkippedIds).toEqual(["residue-grant"]);
    expect(outcome.clearedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(outcome.failedIds).toEqual([]);
  });
});
