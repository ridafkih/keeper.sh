import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const CRON_DATABASE_POOL_MAX = 25;
const OAUTH_SOURCE_COUNT = 400;

const probe = vi.hoisted(() => ({ concurrent: 0, peakConcurrent: 0, queries: 0 }));

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const trackedQuery = vi.hoisted(() => async (rows: unknown[]): Promise<unknown[]> => {
  probe.concurrent += 1;
  probe.queries += 1;
  probe.peakConcurrent = Math.max(probe.peakConcurrent, probe.concurrent);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  probe.concurrent -= 1;
  return rows;
});

const oauthSources = vi.hoisted(() => Array.from({ length: 400 }, (_unused, index) => ({
  accountId: `account-${index}`,
  accessToken: "token",
  calendarId: `calendar-${index}`,
  expiresAt: new Date(Date.now() + 3_600_000),
  externalCalendarId: `external-${index}`,
  ingestFutureRange: "1_month",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: `credential-${index}`,
  provider: "google",
  reauthenticationSource: null,
  refreshToken: "refresh",
  syncToken: null,
  userId: `user-${index}`,
})));

vi.mock("../../src/env", () => ({ default: { DATABASE_POOL_MAX: 25, ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => {
  const builder = (rows: unknown[]): Record<string, unknown> => {
    const chainable: Record<string, unknown> = {};
    const chain = (): unknown => chainable;
    chainable.from = chain;
    chainable.innerJoin = chain;
    chainable.leftJoin = chain;
    chainable.limit = () => trackedQuery([]);
    /* Only terminal calls are awaited; tracking mid-chain would count queries never issued. */
    chainable.where = () => Object.assign(Promise.resolve([]), {
      limit: () => trackedQuery([]),
      orderBy: () => trackedQuery(rows),
    });
    return chainable;
  };
  return {
    flushDrainRegistry: { register: (): null => null },
    database: {
      select: (fields: Record<string, unknown>) => {
        if ("refreshToken" in fields) {
          return builder(oauthSources);
        }
        return builder([]);
      },
      update: () => ({ set: () => ({ where: () => trackedQuery([]) }) }),
    },
    flushDatabase: { transaction: () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }) },
    premiumService: { getUserPlan: () => Promise.resolve("pro") },
    refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
    refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
  };
});
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));
vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

let job: typeof ingestSourcesJob | null = null;
let passBound = 0;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
  passBound = module.FLEET_PASS_SOURCE_BOUND;
});

beforeEach(() => {
  probe.concurrent = 0;
  probe.peakConcurrent = 0;
  probe.queries = 0;
});

describe("per-pass ingest scheduling", () => {
  it("keeps pooled queries inside the pool while launching a bounded prefix at once", async () => {
    await job?.callback();
    await settle();

    expect(probe.queries).toBeGreaterThanOrEqual(passBound);
    expect(probe.queries).toBeLessThan(OAUTH_SOURCE_COUNT);
    expect(probe.peakConcurrent).toBeGreaterThan(0);
    expect(probe.peakConcurrent).toBeLessThan(CRON_DATABASE_POOL_MAX);
  });
});
