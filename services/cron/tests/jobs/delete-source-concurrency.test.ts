import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const capturedOptions: Record<string, unknown>[] = [];

// Where() must be awaitable and chainable: listing queries add orderBy, others do not.
const createQueryBuilder = () => {
  const builder: Record<string, unknown> = {};
  const chain = (): unknown => builder;

  builder.from = chain;
  builder.innerJoin = chain;
  builder.leftJoin = chain;
  builder.limit = () => Promise.resolve([]);
  builder.where = () =>
    Object.assign(Promise.resolve([]), {
      orderBy: () => Promise.resolve([]),
    });

  return builder;
};

const fakeDatabase = {
  select: () => createQueryBuilder(),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

let job: typeof ingestSourcesJob | null = null;

/* ENCRYPTION_KEY set so the CalDAV family does not early-return before its call site. */
vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: fakeDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
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
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));
vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const original = actual.allSettledGroupedWithConcurrency as (
    ...callArguments: unknown[]
  ) => unknown;
  const spied = (...callArguments: unknown[]): unknown => {
    capturedOptions.push({ ...(callArguments[2] as Record<string, unknown>) });
    return original(...callArguments);
  };
  return { ...actual, allSettledGroupedWithConcurrency: spied };
});

const jobSourcePath = fileURLToPath(
  new URL("../../src/jobs/ingest-sources.ts", import.meta.url),
);

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  capturedOptions.length = 0;
});

const CRON_DATABASE_POOL_MAX = 25;

describe("global source throttle removal", () => {
  it("runs oauth and caldav at the pool-sized user-group budget and ics at parse concurrency", async () => {
    await job?.callback();

    expect(capturedOptions).toHaveLength(3);

    const [oauthSite, caldavSite, icsSite] = capturedOptions;

    expect(oauthSite?.groupConcurrency).toBe(caldavSite?.groupConcurrency);
    expect(oauthSite?.taskConcurrency).toBe(2);
    expect(caldavSite?.taskConcurrency).toBe(2);
    expect(icsSite?.taskConcurrency).toBe(2);

    let launchFrontSummedAcrossFamilies = 0;
    for (const options of capturedOptions) {
      launchFrontSummedAcrossFamilies
        += Number(options.groupConcurrency) * Number(options.taskConcurrency);
    }
    expect(launchFrontSummedAcrossFamilies).toBeLessThanOrEqual(CRON_DATABASE_POOL_MAX);
  });

  it("deletes SOURCE_CONCURRENCY from the job in favor of the named budgets", () => {
    const source = readFileSync(jobSourcePath, "utf8");

    expect(source).not.toContain("SOURCE_CONCURRENCY");
    expect(source).toContain("USER_GROUP_CONCURRENCY");
    expect(source).toContain("ICS_PARSE_CONCURRENCY");
  });
});
