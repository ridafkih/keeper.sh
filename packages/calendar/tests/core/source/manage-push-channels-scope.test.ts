import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createManagePushChannelsDependencies } from "../../../src/core/source/manage-push-channels-dependencies";

const ACCOUNT_ID = "b0a0c0d0-0000-4000-8000-000000000001";

const recordingDatabase = (wheres: unknown[]): Pick<
  BunSQLDatabase,
  "insert" | "select" | "update"
> => {
  const database = {
    insert: () => database,
    select: () => database,
    update: () => database,
    from: () => database,
    innerJoin: () => database,
    where: (condition: unknown) => {
      wheres.push(condition);
      return Promise.resolve([]);
    },
  };

  return database as unknown as Pick<BunSQLDatabase, "insert" | "select" | "update">;
};

const scopeOf = async (onlyAccountId?: string): Promise<unknown> => {
  const wheres: unknown[] = [];
  const observed: unknown[] = [];

  await createManagePushChannelsDependencies({
    createRegistrarContext: () => Promise.reject(new Error("no registration in this test")),
    database: recordingDatabase(wheres),
    locks: {
      release: () => Promise.resolve(),
      tryAcquire: () => Promise.resolve(true),
    },
    negativeCache: { del: () => Promise.resolve(0) },
    observe: (fields) => {
      observed.push(fields);
    },
    onlyAccountId,
    recordError: (error) => {
      observed.push(error);
    },
    resolvePlan: () => Promise.resolve("pro"),
    webhookPublicUrl: "https://example.test",
  }).selectEligibleCalendars();

  expect(wheres).toHaveLength(1);
  return wheres[0];
};

const mentions = (condition: unknown, needle: string): boolean => {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): boolean => {
    if (node === needle) {
      return true;
    }
    if (typeof node !== "object" || node === null || visited.has(node)) {
      return false;
    }
    visited.add(node);
    return Object.values(node).some((value) => walk(value));
  };

  return walk(condition);
};

describe("narrowing the sweep to one account", () => {
  it("names the account a scoped run is narrowed to", async () => {
    expect(mentions(await scopeOf(ACCOUNT_ID), ACCOUNT_ID)).toBe(true);
  });

  it("names no account when the run is the whole sweep", async () => {
    expect(mentions(await scopeOf(), ACCOUNT_ID)).toBe(false);
  });
});
