import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  acquireSourceIngestLocks,
  SOURCE_INGEST_LOCK_TIMEOUT_MS,
} from "../../../src/core/source/ingest-lock";
import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";

describe("acquireSourceIngestLocks", () => {
  it("acquires every source lock before running work", async () => {
    const order: string[] = [];
    const queries: SQL[] = [];
    const execute = vi.fn((query: SQL) => {
      queries.push(query);
      order.push("lock");
      return Promise.resolve();
    });
    const transaction = { execute };

    const result = await acquireSourceIngestLocks(
      transaction,
      ["source-a", "source-b"],
      (lockedDatabase) => {
        expect(lockedDatabase).toBe(transaction);
        order.push("work");
        return Promise.resolve("complete");
      },
    );

    expect(result).toBe("complete");
    expect(execute).toHaveBeenCalledTimes(4);
    expect(order).toEqual(["lock", "lock", "lock", "lock", "work"]);

    const dialect = new PgDialect();
    const renderedQueries = queries.map((query) => dialect.sqlToQuery(query));
    expect(renderedQueries[0]?.sql).toContain("set_config");
    expect(renderedQueries[0]?.params).toEqual([
      String(SOURCE_INGEST_LOCK_TIMEOUT_MS),
    ]);
    expect(renderedQueries[1]?.sql).toContain("set_config");
    expect(renderedQueries[1]?.params).toEqual([
      String(INGEST_SOURCE_TIMEOUT_MS + 5000),
    ]);
    expect(renderedQueries.slice(2).every(({ sql }) => sql.includes("pg_advisory_xact_lock")))
      .toBe(true);
  });
});
