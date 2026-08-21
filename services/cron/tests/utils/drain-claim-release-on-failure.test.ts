import { beforeEach, describe, expect, it, vi } from "vitest";

const CLAIM_LIMIT = 50;

const correlationError = new Error("correlation read failed");
const releaseError = new Error("release failed");

const state = {
  deletedKeys: [] as string[],
  releaseFails: false,
};

const fakeRedis = {
  del: (...keys: string[]): Promise<number> => {
    state.deletedKeys.push(...keys);
    if (state.releaseFails) {
      return Promise.reject(releaseError);
    }
    return Promise.resolve(keys.length);
  },
  hmget: (): Promise<(string | null)[]> => Promise.reject(correlationError),
  hsetnx: (): Promise<number> => Promise.resolve(0),
  set: (): Promise<string | null> => Promise.resolve("OK"),
  zrange: (): Promise<string[]> =>
    Promise.resolve(["cal-a", "1000", "cal-b", "2000"]),
  zscore: (): Promise<string | null> => Promise.resolve("1000"),
};

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key", WEBHOOK_PUBLIC_URL: "https://www.example.com" },
}));
vi.mock("../../src/context", () => ({
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: fakeRedis,
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/jobs/ingest-sources", () => ({
  ingestOAuthSources: () => Promise.resolve({ affectedUserIds: [] }),
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const { buildClaimKey } = await import("../../src/utils/pending-ingest-claim");
const { createDefaultDependencies } = await import("../../src/jobs/drain-pending-ingest");
const { createScopedClaimPending } = await import("../../src/utils/scoped-drain-pending-ingest");

const expectedClaimKeys = [buildClaimKey("cal-a"), buildClaimKey("cal-b")].toSorted();

beforeEach(() => {
  state.deletedKeys = [] as string[];
  state.releaseFails = false;
});

describe("a failed claim releases what it reserved", () => {
  it("releases the tick claim reservations when the correlation read rejects", async () => {
    const { claimPending } = await createDefaultDependencies();

    await expect(claimPending(CLAIM_LIMIT)).rejects.toBe(correlationError);

    expect(state.deletedKeys.toSorted()).toEqual(expectedClaimKeys);
  });

  it("surfaces the original rejection even when the release itself fails", async () => {
    state.releaseFails = true;
    const { claimPending } = await createDefaultDependencies();

    await expect(claimPending(CLAIM_LIMIT)).rejects.toBe(correlationError);

    expect(state.deletedKeys.toSorted()).toEqual(expectedClaimKeys);
  });

  it("releases the scoped claim reservations when the correlation read rejects", async () => {
    const claimPending = createScopedClaimPending(fakeRedis, ["cal-a", "cal-b"]);

    await expect(claimPending(CLAIM_LIMIT)).rejects.toBe(correlationError);

    expect(state.deletedKeys.toSorted()).toEqual(expectedClaimKeys);
  });
});
