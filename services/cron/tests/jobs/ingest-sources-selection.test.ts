import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { calendarsTable } from "@keeper.sh/database/schema";
import type { ingestOAuthSources as ingestOAuthSourcesFn } from "../../src/ingest/ingest-sources";
import type { ingestSourceCalendars as IngestSourceCalendars } from "../../src/ingest/ingest-sources";

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
let ingestSourceCalendars: typeof IngestSourceCalendars | null = null;

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
  const module = await import("../../src/ingest/ingest-sources");
  ({ ingestOAuthSources } = module);
  ({ ingestSourceCalendars } = module);
});

beforeEach(() => {
  capturedPredicates.length = 0;
  capturedOrderings.length = 0;
});

const CLAIM_ORDERING = [asc(calendarsTable.id)];

const renderOrdering = (ordering: unknown[]): string[] => {
  const dialect = new PgDialect();
  return ordering.map(
    (term) => dialect.sqlToQuery(term as Parameters<PgDialect["sqlToQuery"]>[0]).sql,
  );
};

describe("claimed source selection", () => {
  it("reads only the claimed live pull calendars", async () => {
    await ingestOAuthSources(["cal-1", "cal-2"]);

    expect(capturedPredicates).toHaveLength(1);
    expect(capturedPredicates[0]).toEqual(and(
      arrayContains(calendarsTable.capabilities, ["pull"]),
      eq(calendarsTable.disabled, false),
      inArray(calendarsTable.id, ["cal-1", "cal-2"]),
    ));
  });

  it("does not query at all for an empty claim", async () => {
    await ingestOAuthSources([]);
    await ingestSourceCalendars?.([]);

    expect(capturedPredicates).toHaveLength(0);
  });

  it("filters every source family by the claimed ids", async () => {
    await ingestSourceCalendars?.(["cal-1"]);

    expect(capturedPredicates).toEqual([
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, ["cal-1"]),
      ),
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, ["cal-1"]),
      ),
      and(
        eq(calendarsTable.calendarType, "ical"),
        eq(calendarsTable.disabled, false),
        inArray(calendarsTable.id, ["cal-1"]),
      ),
    ]);
  });

  it("reads every source family in a stable order", async () => {
    await ingestSourceCalendars?.(["cal-1"]);

    expect(capturedOrderings.map((ordering) => renderOrdering(ordering as unknown[]))).toEqual([
      renderOrdering(CLAIM_ORDERING),
      renderOrdering(CLAIM_ORDERING),
      renderOrdering(CLAIM_ORDERING),
    ]);
  });
});
