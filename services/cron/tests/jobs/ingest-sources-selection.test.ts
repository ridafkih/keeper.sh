import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, arrayContains, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { calendarsTable, userSubscriptionsTable } from "@keeper.sh/database/schema";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";
import type { ingestOAuthSources as ingestOAuthSourcesFn } from "../../src/jobs/ingest-sources";

const capturedPredicates: unknown[] = [];
const capturedOrderings: unknown[] = [];

/*
 * A real resolved promise carrying an orderBy method comes back from where(): the
 * listing queries chain into orderBy(), while other selects in the same job
 * stop at where() or limit() and are awaited directly.
 */
const createQueryBuilder = () => {
  const builder: Record<string, unknown> = {};
  const chain = (): unknown => builder;

  builder.from = chain;
  builder.innerJoin = chain;
  builder.leftJoin = chain;
  builder.limit = () => Promise.resolve([]);
  builder.where = (predicate: unknown) => {
    capturedPredicates.push(predicate);
    return Object.assign(Promise.resolve([]), {
      orderBy: (...orderings: unknown[]) => {
        capturedOrderings.push(orderings);
        return Promise.resolve([]);
      },
    });
  };

  return builder;
};

const fakeDatabase = {
  select: () => createQueryBuilder(),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

let ingestOAuthSources: typeof ingestOAuthSourcesFn = () =>
  Promise.reject(new Error("Module not loaded"));
let job: typeof ingestSourcesJob | null = null;

/* ENCRYPTION_KEY set so the CalDAV family does not early-return before its listing. */
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

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  ({ ingestOAuthSources } = module);
  job = module.default;
});

beforeEach(() => {
  capturedPredicates.length = 0;
  capturedOrderings.length = 0;
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

  it("puts never-ingested calendars first, then pro users", async () => {
    await ingestOAuthSources();

    expect(capturedOrderings).toEqual([[
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
      asc(calendarsTable.id),
    ]]);
  });

  /*
   * Pinned as rendered SQL, not AST: without the coalesce, NULL plans sort ahead
   * of every pro user, inverting the priority for the majority case.
   */
  it("renders a null-safe pro ordering", async () => {
    await ingestOAuthSources();

    const dialect = new PgDialect();
    const [ordering] = capturedOrderings as [unknown[]];
    const rendered = dialect.sqlToQuery(ordering[1] as Parameters<PgDialect["sqlToQuery"]>[0]);

    expect(rendered.sql).toContain("coalesce(");
    expect(rendered.sql).toContain("= 'pro'");
  });

  it("orders every source family the same way", async () => {
    await job?.callback();

    expect(capturedOrderings).toEqual([[
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
      asc(calendarsTable.id),
    ], [
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
      asc(calendarsTable.id),
    ], [
      desc(isNull(calendarsTable.ingestWindowRecordedAt)),
      desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
      asc(calendarsTable.id),
    ]]);
  });
});
