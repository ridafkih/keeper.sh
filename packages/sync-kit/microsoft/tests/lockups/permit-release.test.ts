import { describe, expect, test } from "vitest";
import { createMailboxSemaphore } from "../../src/client/semaphore";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("a permit is structural, not a happy-path unlock", () => {
  test("MS-L13: a permit is released when the body throws", async () => {
    const permits = createMailboxSemaphore(1);

    await expect(
      permits.withPermits(["mailbox-one"], neverAborts(), () =>
        Promise.reject(new Error("the body threw where the unlock lived")),
      ),
    ).rejects.toThrow("the body threw where the unlock lived");
    const afterwards = await permits.withPermits(["mailbox-one"], neverAborts(), () =>
      Promise.resolve("the next caller still got its permit"),
    );

    expect(afterwards).toBe("the next caller still got its permit");
    expect(permits.held("mailbox-one")).toBe(0);
    expect(permits.waiting("mailbox-one")).toBe(0);
  }, 30_000);

  test("MS-L13: a permit is released when the caller is aborted mid-body", async () => {
    const permits = createMailboxSemaphore(1);
    const caller = new AbortController();
    const holding = permits.withPermits(["mailbox-one"], caller.signal, () =>
      Promise.withResolvers<string>().promise,
    );
    caller.abort();
    await holding.catch(() => null);

    expect(permits.held("mailbox-one")).toBe(0);
  }, 30_000);
});
