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


beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  capturedOptions.length = 0;
});

const UNBOUNDED_USER_GROUPS = 1000;

/*
 * The three families fan out concurrently, so which of them reaches its call site first is a
 * scheduling detail: the budgets are read as a multiset, never by arrival position.
 */
const budgets = (key: string): number[] =>
  capturedOptions.map((options) => Number(options[key])).toSorted((left, right) => left - right);

describe("global source throttle removal", () => {
  it("runs oauth and caldav unbounded and keeps ics at its cpu-bound parse budget", async () => {
    await job?.callback();

    expect(capturedOptions).toHaveLength(3);

    const [icsGroup, ...unboundedGroups] = budgets("groupConcurrency");

    expect(icsGroup).toBeLessThan(UNBOUNDED_USER_GROUPS);
    expect(unboundedGroups[0]).toBe(unboundedGroups[1]);
    expect(Number(unboundedGroups[0])).toBeGreaterThanOrEqual(UNBOUNDED_USER_GROUPS);

    const [icsTask, ...unboundedTasks] = budgets("taskConcurrency");

    expect(icsTask).toBeLessThan(UNBOUNDED_USER_GROUPS);
    expect(Number(unboundedTasks[0])).toBeGreaterThanOrEqual(UNBOUNDED_USER_GROUPS);
    expect(Number(unboundedTasks[1])).toBeGreaterThanOrEqual(UNBOUNDED_USER_GROUPS);
  });


});
