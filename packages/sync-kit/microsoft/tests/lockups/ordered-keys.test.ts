import { describe, expect, test } from "vitest";
import { createMailboxSemaphore } from "../../src/client/semaphore";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("two ingests over overlapping keys cannot deadlock", () => {
  test("MS-L15: two callers acquiring the same two keys in opposite orders both complete", async () => {
    const permits = createMailboxSemaphore(1);
    const order: string[] = [];

    const forwards = permits.withPermits(["mailbox-a", "mailbox-b"], neverAborts(), async () => {
      order.push("forwards");
      await Promise.resolve();
      return "forwards";
    });
    const backwards = permits.withPermits(["mailbox-b", "mailbox-a"], neverAborts(), async () => {
      order.push("backwards");
      await Promise.resolve();
      return "backwards";
    });

    await expect(Promise.all([forwards, backwards])).resolves.toEqual(["forwards", "backwards"]);
    expect(order).toHaveLength(2);
    expect(permits.held("mailbox-a")).toBe(0);
    expect(permits.held("mailbox-b")).toBe(0);
  }, 30_000);
});
