import { describe, expect, test } from "vitest";
import { createCollectionSemaphore } from "../../src/client/semaphore";
import { neverAborts } from "../support/harness";

const collection = "/calendars/alice/personal/";

const raising = (): Promise<string> => {
  throw new TypeError("the caller blew up before it awaited anything");
};

describe("a permit is released however its body leaves", () => {
  test("DAV-L8: a body that throws before its first await still releases the permit", async () => {
    const permits = createCollectionSemaphore(2);
    for (const attempt of [1, 2]) {
      const refused = await permits
        .withPermits([collection], neverAborts(), raising)
        .then(() => "settled", () => `refused-${attempt}`);
      expect(refused).toBe(`refused-${attempt}`);
    }

    expect(permits.held(collection)).toBe(0);
    expect(await permits.withPermits([collection], neverAborts(), () => Promise.resolve("ran"))).toBe(
      "ran",
    );
  }, 30_000);

  test("DAV-L10: a queued waiter that aborts is refused while the permits are still held", async () => {
    const permits = createCollectionSemaphore(1);
    const holding = Promise.withResolvers<string>();
    const waiter = new AbortController();

    const leader = permits.withPermits([collection], neverAborts(), () => holding.promise);
    const follower = permits.withPermits([collection], waiter.signal, () =>
      Promise.resolve("should never run"),
    );
    await Promise.resolve();
    waiter.abort();

    await expect(follower).rejects.toThrow("collection permit");
    expect(permits.waiting(collection)).toBe(0);

    holding.resolve("done");
    expect(await leader).toBe("done");
    expect(permits.held(collection)).toBe(0);
  }, 30_000);
});
