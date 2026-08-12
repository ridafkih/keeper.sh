import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const rowsByTable = new Map<string, unknown[]>();
const insertCalls: string[] = [];
let plan: "free" | "pro" = "free";

const resolveLimit = (resolvedPlan: string, freeLimit: number): number => {
  if (resolvedPlan === "pro") {
    return Infinity;
  }
  return freeLimit;
};

const database = {
  select: () => ({
    from: (table: unknown) => {
      const rows = rowsByTable.get(getTableName(table as never)) ?? [];
      return Object.assign(Promise.resolve(rows), {
        where: () => Promise.resolve(rows),
      });
    },
  }),
  insert: (table: unknown) => {
    insertCalls.push(getTableName(table as never));
    throw new Error("/api/entitlements must not write");
  },
};

const premiumService = {
  getUserPlan: () => Promise.resolve(plan),
  getAccountLimit: (resolvedPlan: string) => resolveLimit(resolvedPlan, 2),
  getMappingLimit: (resolvedPlan: string) => resolveLimit(resolvedPlan, 3),
  getFeedLimit: (resolvedPlan: string) => resolveLimit(resolvedPlan, 1),
};

vi.mock("../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../src/context", () => ({
  baseUrl: "https://keeper.sh",
  database,
  premiumService,
}));
vi.mock("../../../src/utils/source-destination-mappings", () => ({
  getUserMappings: () => Promise.resolve([]),
}));

type EntitlementsHandler = (context: { userId: string }) => Promise<Response>;

interface EntitlementsBody {
  plan: string;
  accounts: { current: number; limit: number | null };
  mappings: { current: number; limit: number | null };
  feeds?: { current: number; limit: number | null };
}

let readEntitlements: EntitlementsHandler = () =>
  Promise.reject(new Error("Module not loaded"));

const readBody = async (): Promise<EntitlementsBody> => {
  const response = await readEntitlements({ userId: "user-1" });
  return await response.json() as EntitlementsBody;
};

beforeAll(async () => {
  const module = await import("../../../src/routes/api/entitlements") as unknown as {
    GET: EntitlementsHandler;
  };
  readEntitlements = module.GET;
});

afterEach(() => {
  rowsByTable.clear();
  insertCalls.length = 0;
  plan = "free";
});

describe("GET /api/entitlements", () => {
  it("reports the free feed allowance alongside the existing limits", async () => {
    rowsByTable.set("calendar_accounts", [{ id: "account-1" }]);
    rowsByTable.set("ical_feeds", [{ id: "feed-default" }]);

    const body = await readBody();

    expect(body.feeds).toEqual({ current: 1, limit: 1 });
  });

  it("serialises an unlimited pro feed allowance as null", async () => {
    plan = "pro";
    rowsByTable.set("calendar_accounts", []);
    rowsByTable.set("ical_feeds", [
      { id: "feed-default" },
      { id: "feed-work" },
      { id: "feed-family" },
    ]);

    const body = await readBody();

    expect(body.feeds).toEqual({ current: 3, limit: null });
    expect(body.accounts.limit).toBeNull();
  });

  it("counts every feed the user owns, including the backfilled default", async () => {
    rowsByTable.set("calendar_accounts", []);
    rowsByTable.set("ical_feeds", [{ id: "feed-default" }, { id: "feed-work" }]);

    const body = await readBody();

    expect(body.feeds?.current).toBe(2);
  });

  it("never creates a feed from the reporting endpoint", async () => {
    rowsByTable.set("calendar_accounts", []);
    rowsByTable.set("ical_feeds", []);

    const body = await readBody();

    expect(insertCalls).toEqual([]);
    expect(body.feeds).toEqual({ current: 0, limit: 1 });
  });
});
