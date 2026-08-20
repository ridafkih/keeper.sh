import { describe, expect, it } from "vitest";

const { describeSignalReader, recordStartedSignalReader } = await import(
  "../../src/utils/signal-reader-state"
);

describe("what the drain tick can say about the signal reader", () => {
  it("reports no reader at all before one has started, which is the deployment case", () => {
    expect(describeSignalReader()).toEqual({ reads: 0, running: false });
  });

  it("reports a reader that has done nothing yet as running with no reads", () => {
    recordStartedSignalReader({
      readCount: () => 0,
      start: () => null,
      stop: () => Promise.resolve(),
    });

    expect(describeSignalReader()).toEqual({ reads: 0, running: true });
  });

  it("separates a wedged reader from a working one by what it has read", () => {
    let reads = 0;
    recordStartedSignalReader({
      readCount: () => reads,
      start: () => null,
      stop: () => Promise.resolve(),
    });

    const wedged = describeSignalReader();
    reads = 7;
    const working = describeSignalReader();

    expect(wedged.reads).toBe(0);
    expect(working.reads).toBe(7);
    expect(working.running).toBe(true);
  });
});
