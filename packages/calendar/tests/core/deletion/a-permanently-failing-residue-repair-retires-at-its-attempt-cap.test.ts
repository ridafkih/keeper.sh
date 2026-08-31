import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { PUSH_CHANNEL_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const PAST = new Date("2026-08-25T12:00:00.000Z");
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;
const REPAIR_DEADLINE_MS = 30_000;
const ATTEMPTS_BELOW_THE_CAP = 6;

const unrepairablePushRecord = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: new Date("2026-08-18T06:15:33.956Z"),
  expiresAt: FUTURE,
  id: "residue-push",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerResourceId: "resource-1",
  userId: "user-push",
  ...overrides,
});

const createStore = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      rows.delete(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows.values()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      const claimed = rows.get(residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      return Promise.resolve(claimed.attempts ?? 0);
    },
  };

  return { rows, store };
};

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const createRegistrar = (): SourcePushRegistrar =>
  ({
    deregister: (_channel: StoredPushChannel) => Promise.resolve(),
    maxLifetimeMs: 604_800_000,
    provider: "google",
    register: () => Promise.reject(new Error("register is not part of this test")),
    renew: () => Promise.reject(new Error("renew is not part of this test")),
    renewalMode: "renew",
    resolveAffectedCalendarIds: () => Promise.resolve([]),
    scopeKind: "account",
  }) as unknown as SourcePushRegistrar;

const createReaper = (seed: TeardownResidueRecord[]) => {
  const { rows, store } = createStore(seed);
  const errors: { error: unknown; slug: string }[] = [];
  const registrar = createRegistrar();

  const reap = createTeardownResidueReaper({
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: store,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { errors, reap, rows };
};

describe("a permanently failing residue repair retires at its attempt cap", () => {
  it("retires a push residue whose repair can never succeed once it reaches the cap", async () => {
    const harness = createReaper([unrepairablePushRecord({ expiresAt: PAST })]);

    const outcome = await harness.reap();

    expect(outcome.expiredIds).toContain("residue-push");
    expect(outcome.failedIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual([]);
  });

  it("keeps retrying a failing residue below the cap whose expiry is still in the future", async () => {
    const harness = createReaper([
      unrepairablePushRecord({ attempts: ATTEMPTS_BELOW_THE_CAP }),
    ]);

    const outcome = await harness.reap();

    expect(outcome.failedIds).toEqual(["residue-push"]);
    expect(outcome.expiredIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual(["residue-push"]);
  });
});
