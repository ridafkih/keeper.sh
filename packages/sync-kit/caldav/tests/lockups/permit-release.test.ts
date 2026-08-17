import { describe, expect, test } from "vitest";
import { createCollectionSemaphore } from "../../src/client/semaphore";

const neverAborts = (): AbortSignal => new AbortController().signal;

const collection = "/calendars/alice/personal/";

describe("a collection permit is structural, not a happy-path unlock", () => {
  test("DAV-L8: a throwing body releases its permit", async () => {
    const permits = createCollectionSemaphore(1);

    await expect(
      permits.withPermits([collection], neverAborts(), () =>
        Promise.reject(new Error("the body threw where the unlock lived")),
      ),
    ).rejects.toThrow("the body threw where the unlock lived");

    const runs: number[] = [];
    for (const attempt of [1, 2]) {
      const answered = await permits.withPermits([collection], neverAborts(), () =>
        Promise.resolve(attempt),
      );
      runs.push(answered);
    }

    expect(runs).toEqual([1, 2]);
    expect(permits.held(collection)).toBe(0);
    expect(permits.waiting(collection)).toBe(0);
  }, 30_000);

  test("DAV-L9: an aborted waiter is refused the permit rather than running", async () => {
    const permits = createCollectionSemaphore(1);
    const bodies: string[] = [];
    const holding = Promise.withResolvers<null>();
    const leader = permits.withPermits([collection], neverAborts(), async () => {
      bodies.push("leader");
      await holding.promise;
    });
    const waiter = new AbortController();
    const queued = permits.withPermits([collection], waiter.signal, () => {
      bodies.push("waiter");
      return Promise.resolve();
    });
    waiter.abort();
    holding.resolve(null);
    await leader;

    await expect(queued).rejects.toThrow();
    expect(bodies).toEqual(["leader"]);
    expect(permits.held(collection)).toBe(0);
  }, 30_000);

  test("DAV-L10: cancelling a queued task re-drives the queue", async () => {
    const permits = createCollectionSemaphore(1);
    const completed: string[] = [];
    const holding = Promise.withResolvers<null>();
    const leader = permits.withPermits([collection], neverAborts(), () => holding.promise);
    const head = new AbortController();
    const cancelled = permits.withPermits([collection], head.signal, () => Promise.resolve());
    const followers = ["second", "third"].map((name) =>
      permits.withPermits([collection], neverAborts(), () => {
        completed.push(name);
        return Promise.resolve();
      }),
    );

    expect(permits.waiting(collection)).toBe(3);
    head.abort();
    holding.resolve(null);
    await leader;
    await Promise.all(followers);

    await expect(cancelled).rejects.toThrow();
    expect(completed).toEqual(["second", "third"]);
    expect(permits.waiting(collection)).toBe(0);
    expect(permits.held(collection)).toBe(0);
  }, 30_000);
});
