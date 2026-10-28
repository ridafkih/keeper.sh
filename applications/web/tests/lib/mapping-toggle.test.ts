import { describe, expect, it } from "vitest";
import { toggleMappingId, type MappingToggleDependencies } from "../../src/lib/mapping-toggle";

function deferred() {
  const handle: {
    resolve: () => void;
    reject: (reason?: unknown) => void;
    promise: Promise<void>;
  } = {
    resolve: () => {},
    reject: () => {},
    promise: Promise.resolve(),
  };

  handle.promise = new Promise<void>((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });

  return handle;
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 5; index++) {
    await Promise.resolve();
  }
};

const createDependencies = (committedIds: string[]) => {
  const persisted: string[][] = [];
  const optimistic: string[][] = [];
  const requests: ReturnType<typeof deferred>[] = [];
  let failures = 0;
  let settled = 0;

  const dependencies: MappingToggleDependencies = {
    readCommittedIds: () => committedIds,
    applyOptimistic: (ids) => {
      optimistic.push(ids);
    },
    persist: (ids) => {
      persisted.push(ids);
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    onFailure: () => {
      failures += 1;
    },
    onSettled: () => {
      settled += 1;
    },
  };

  return {
    dependencies,
    persisted,
    optimistic,
    requests,
    failures: () => failures,
    settled: () => settled,
  };
};

describe("toggleMappingId", () => {
  it("keeps every rapid toggle and sends one request at a time", async () => {
    const harness = createDependencies([]);

    toggleMappingId("key-rapid", "a", true, harness.dependencies);
    toggleMappingId("key-rapid", "b", true, harness.dependencies);
    toggleMappingId("key-rapid", "c", true, harness.dependencies);

    expect(harness.optimistic).toEqual([["a"], ["a", "b"], ["a", "b", "c"]]);
    expect(harness.persisted).toEqual([["a"]]);

    harness.requests[0]?.resolve();
    await flushMicrotasks();

    expect(harness.persisted).toEqual([["a"], ["a", "b", "c"]]);

    harness.requests[1]?.resolve();
    await flushMicrotasks();

    expect(harness.persisted).toHaveLength(2);
    expect(harness.settled()).toBe(2);
  });

  it("builds on pending toggles instead of the stale committed ids", async () => {
    const harness = createDependencies(["existing"]);

    toggleMappingId("key-stale", "a", true, harness.dependencies);
    toggleMappingId("key-stale", "existing", false, harness.dependencies);

    harness.requests[0]?.resolve();
    await flushMicrotasks();

    expect(harness.persisted[harness.persisted.length - 1]).toEqual(["a"]);
  });

  it("falls back to committed ids after a failed request", async () => {
    const harness = createDependencies(["existing"]);

    toggleMappingId("key-failure", "a", true, harness.dependencies);
    harness.requests[0]?.reject(new Error("conflict"));
    await flushMicrotasks();

    expect(harness.failures()).toBe(1);

    toggleMappingId("key-failure", "b", true, harness.dependencies);

    expect(harness.persisted[harness.persisted.length - 1]).toEqual(["existing", "b"]);
  });
});
