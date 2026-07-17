import { describe, expect, it, vi } from "vitest";
import { acquireSourceIngestLocks } from "../../../src/core/source/ingest-lock";

describe("acquireSourceIngestLocks", () => {
  it("acquires every source lock before running work", async () => {
    const order: string[] = [];
    const execute = vi.fn(() => {
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
    expect(execute).toHaveBeenCalledTimes(3);
    expect(order).toEqual(["lock", "lock", "lock", "work"]);
  });
});
