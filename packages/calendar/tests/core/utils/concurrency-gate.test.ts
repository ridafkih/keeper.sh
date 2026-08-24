import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "../../../src/core/utils/concurrency-gate";

const GATE_LIMIT = 20;
const LAUNCHED_SOURCES = 2000;

const settleMicrotasks = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe("createConcurrencyGate", () => {
  it("holds concurrent queries at the limit no matter how wide the fan-out", async () => {
    const gate = createConcurrencyGate(GATE_LIMIT);
    let concurrent = 0;
    let peakConcurrent = 0;
    let completed = 0;

    await Promise.all(Array.from({ length: LAUNCHED_SOURCES }, () => gate.run(async () => {
      concurrent += 1;
      peakConcurrent = Math.max(peakConcurrent, concurrent);
      await settleMicrotasks();
      concurrent -= 1;
      completed += 1;
      return null;
    })));

    expect(peakConcurrent).toBeLessThanOrEqual(GATE_LIMIT);
    expect(completed).toBe(LAUNCHED_SOURCES);
    expect(gate.inFlight()).toBe(0);
  });

  it("releases the slot when an operation throws", async () => {
    const gate = createConcurrencyGate(1);

    await expect(gate.run(() => Promise.reject(new Error("query failed")))).rejects.toThrow(
      "query failed",
    );

    await expect(gate.run(() => Promise.resolve("second"))).resolves.toBe("second");
    expect(gate.inFlight()).toBe(0);
  });

  it("admits a waiter as soon as a holder finishes", async () => {
    const gate = createConcurrencyGate(1);
    const order: string[] = [];
    const { promise: firstHolder, resolve: releaseFirst } = Promise.withResolvers<null>();

    const first = gate.run(async () => {
      order.push("first-start");
      await firstHolder;
      order.push("first-end");
      return null;
    });
    const second = gate.run(() => {
      order.push("second-start");
      return Promise.resolve(null);
    });

    await settleMicrotasks();
    expect(order).toEqual(["first-start"]);

    releaseFirst(null);
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });
});
