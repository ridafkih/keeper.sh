import { describe, expect, it } from "vitest";
import { serializedPatch, serializedCall } from "../../src/lib/serialized-mutate";

function deferred<T = void>() {
  const handle: {
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
    promise: Promise<T>;
  } = {
    resolve: () => {},
    reject: () => {},
    promise: Promise.resolve() as Promise<T>,
  };

  handle.promise = new Promise<T>((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });

  return handle;
}

describe("serializedPatch", () => {
  it("flushes immediately when nothing is in-flight", async () => {
    const flushed: Record<string, unknown>[] = [];

    serializedPatch("key-a", { field: true }, async (patch) => {
      flushed.push(patch);
    });

    await Promise.resolve();
    expect(flushed).toEqual([{ field: true }]);
  });

  it("queues patches while a request is in-flight and merges them", async () => {
    const flushed: Record<string, unknown>[] = [];
    const first = deferred();

    serializedPatch("key-b", { a: true }, () => first.promise);

    serializedPatch("key-b", { b: true }, async (patch) => {
      flushed.push(patch);
    });
    serializedPatch("key-b", { c: true }, async (patch) => {
      flushed.push(patch);
    });

    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(flushed).toEqual([{ b: true, c: true }]);
  });

  it("processes multiple generations sequentially", async () => {
    const order: string[] = [];
    const first = deferred();
    const second = deferred();

    serializedPatch("key-c", { gen: 1 }, () => {
      order.push("gen1-start");
      return first.promise.then(() => order.push("gen1-end"));
    });

    serializedPatch("key-c", { gen: 2 }, () => {
      order.push("gen2-start");
      return second.promise.then(() => order.push("gen2-end"));
    });

    expect(order).toEqual(["gen1-start"]);

    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["gen1-start", "gen1-end", "gen2-start"]);

    second.resolve();
    await second.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["gen1-start", "gen1-end", "gen2-start", "gen2-end"]);
  });

  it("drains the queue even when flush rejects", async () => {
    const flushed: Record<string, unknown>[] = [];
    const errors: unknown[] = [];
    const failing = deferred();

    serializedPatch("key-d", { a: true }, () => failing.promise, (error) => {
      errors.push(error);
    });

    serializedPatch("key-d", { b: true }, async (patch) => {
      flushed.push(patch);
    });

    failing.reject(new Error("network error"));
    await failing.promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(flushed).toEqual([{ b: true }]);
    expect(errors).toHaveLength(1);
  });

  it("uses independent queues for different keys", async () => {
    const flushed: Array<{ key: string; patch: Record<string, unknown> }> = [];
    const first = deferred();

    serializedPatch("key-e1", { a: true }, () => first.promise);
    serializedPatch("key-e2", { b: true }, async (patch) => {
      flushed.push({ key: "key-e2", patch });
    });

    await Promise.resolve();
    expect(flushed).toEqual([{ key: "key-e2", patch: { b: true } }]);

    first.resolve();
    await first.promise;
  });

  it("later patches overwrite earlier patches for the same field", async () => {
    const flushed: Record<string, unknown>[] = [];
    const first = deferred();

    serializedPatch("key-f", { toggle: true }, () => first.promise);

    serializedPatch("key-f", { toggle: false }, async (patch) => {
      flushed.push(patch);
    });
    serializedPatch("key-f", { toggle: true }, async (patch) => {
      flushed.push(patch);
    });

    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(flushed).toEqual([{ toggle: true }]);
  });
});

describe("serializedCall", () => {
  it("executes immediately when nothing is in-flight", async () => {
    const calls: string[] = [];

    serializedCall("call-a", async () => {
      calls.push("executed");
    });

    await Promise.resolve();
    expect(calls).toEqual(["executed"]);
  });

  it("queues the latest callback and discards earlier ones", async () => {
    const calls: string[] = [];
    const first = deferred();

    serializedCall("call-b", () => first.promise);

    serializedCall("call-b", async () => {
      calls.push("second");
    });
    serializedCall("call-b", async () => {
      calls.push("third");
    });

    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["third"]);
  });

  it("drains the queue even when callback rejects", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const failing = deferred();

    serializedCall("call-c", () => failing.promise, (error) => {
      errors.push(error);
    });

    serializedCall("call-c", async () => {
      calls.push("recovered");
    });

    failing.reject(new Error("network error"));
    await failing.promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["recovered"]);
    expect(errors).toHaveLength(1);
  });

  it("uses independent queues for different keys", async () => {
    const calls: string[] = [];
    const first = deferred();

    serializedCall("call-d1", () => first.promise);
    serializedCall("call-d2", async () => {
      calls.push("d2");
    });

    await Promise.resolve();
    expect(calls).toEqual(["d2"]);

    first.resolve();
    await first.promise;
  });
});
