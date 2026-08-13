import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { calendarsTable } from "@keeper.sh/database/schema";
import type { ingestOAuthSources as ingestOAuthSourcesFn } from "../../src/jobs/ingest-sources";

const capturedPredicates: unknown[] = [];

const createQueryBuilder = () => {
  const builder: Record<string, unknown> = {};
  const chain = (): unknown => builder;

  builder.from = chain;
  builder.innerJoin = chain;
  builder.leftJoin = chain;
  builder.limit = () => Promise.resolve([]);
  builder.where = (predicate: unknown) => {
    capturedPredicates.push(predicate);
    return Promise.resolve([]);
  };

  return builder;
};

const fakeDatabase = {
  select: () => createQueryBuilder(),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

let ingestOAuthSources: typeof ingestOAuthSourcesFn = () =>
  Promise.reject(new Error("Module not loaded"));

vi.mock("../../src/env", () => ({ default: {} }));
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

beforeAll(async () => {
  ({ ingestOAuthSources } = await import("../../src/jobs/ingest-sources"));
});

beforeEach(() => {
  capturedPredicates.length = 0;
});

describe("ingestOAuthSources selection", () => {
  it("selects every live pull calendar when given no ids", async () => {
    await ingestOAuthSources();

    expect(capturedPredicates).toHaveLength(1);
    expect(capturedPredicates[0]).toEqual(and(
      arrayContains(calendarsTable.capabilities, ["pull"]),
      eq(calendarsTable.disabled, false),
    ));
  });

  it("adds exactly one id filter when given ids", async () => {
    await ingestOAuthSources(["cal-1", "cal-2"]);

    expect(capturedPredicates).toHaveLength(1);
    expect(capturedPredicates[0]).toEqual(and(
      arrayContains(calendarsTable.capabilities, ["pull"]),
      eq(calendarsTable.disabled, false),
      inArray(calendarsTable.id, ["cal-1", "cal-2"]),
    ));
  });

  it("does not query at all for an empty id list", async () => {
    await ingestOAuthSources([]);

    expect(capturedPredicates).toHaveLength(0);
  });
});
