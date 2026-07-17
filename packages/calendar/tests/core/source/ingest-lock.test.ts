import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { describe, expect, it, vi } from "vitest";
import { withSourceIngestLocks } from "../../../src/core/source/ingest-lock";

describe("withSourceIngestLocks", () => {
  it("acquires every distinct source lock before running work in the transaction", async () => {
    const order: string[] = [];
    const execute = vi.fn(() => {
      order.push("lock");
      return Promise.resolve();
    });
    const transaction = vi.fn(async (callback: (transaction: { execute: typeof execute }) => Promise<string>) => {
      order.push("transaction-start");
      const result = await callback({ execute });
      order.push("transaction-end");
      return result;
    });
    const database = { transaction } as unknown as BunSQLDatabase;

    const result = await withSourceIngestLocks(
      database,
      ["source-b", "source-a", "source-b"],
      () => {
        order.push("work");
        return Promise.resolve("complete");
      },
    );

    expect(result).toBe("complete");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(order).toEqual([
      "transaction-start",
      "lock",
      "lock",
      "work",
      "transaction-end",
    ]);
  });

  it("runs without opening a transaction when there are no source calendars", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as BunSQLDatabase;
    const work = vi.fn(() => Promise.resolve("complete"));

    await expect(withSourceIngestLocks(database, [], work)).resolves.toBe("complete");
    expect(work).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });
});
