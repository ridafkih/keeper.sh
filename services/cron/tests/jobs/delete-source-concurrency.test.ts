import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Every options argument handed to allSettledGroupedWithConcurrency across the
 * whole pass lands here, one record per call site, in call order.
 */
const capturedOptions: Record<string, unknown>[] = [];

/*
 * A real resolved promise carrying an orderBy method comes back from where():
 * the listing queries chain into orderBy(), while other selects in the same
 * job stop at where() or limit() and are awaited directly.
 */
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

describe("global source throttle removal", () => {
  /*
   * Provider protection, fairness, write pressure, and memory each have a
   * dedicated mechanism now, so the group budget at the oauth and caldav call
   * sites is effectively unlimited for the fleet (UNBOUNDED_USER_GROUPS =
   * 1000), while the per-account Graph budget within a pass stays at
   * USER_CALENDAR_CONCURRENCY = 2. ICS keeps a small dedicated group budget
   * (ICS_PARSE_CONCURRENCY = 4) because parsing is CPU-bound and starves the
   * Bun event loop.
   */
  it("runs oauth and caldav effectively unbounded and ics at parse concurrency", async () => {
    await job?.callback();

    expect(capturedOptions).toHaveLength(3);

    const unboundedSites = capturedOptions.filter(
      (options) => options.groupConcurrency === 1000,
    );
    const icsSites = capturedOptions.filter(
      (options) => options.groupConcurrency === 4,
    );

    expect(unboundedSites).toHaveLength(2);
    expect(icsSites).toHaveLength(1);

    for (const options of unboundedSites) {
      expect(options.taskConcurrency).toBe(2);
    }
  });

  /*
   * Grep-level pin: the global throttle constant is deleted outright, replaced
   * by the named constants above. File-text assertion per repo precedent for
   * existence pins.
   */
  it("deletes SOURCE_CONCURRENCY from the job in favor of the named budgets", () => {
    const source = readFileSync(jobSourcePath, "utf8");

    expect(source).not.toContain("SOURCE_CONCURRENCY");
    expect(source).toContain("UNBOUNDED_USER_GROUPS");
    expect(source).toContain("ICS_PARSE_CONCURRENCY");
  });
});
