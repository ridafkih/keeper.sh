import { describe, expect, it } from "vitest";
import { allSettledGroupedWithConcurrency } from "../../../src/core/utils/concurrency";

const settle = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

describe("allSettledGroupedWithConcurrency", () => {
  it("returns settlements in the original task order", async () => {
    const tasks = [3, 1, 4, 1, 5].map((value, index) => async () => {
      await settle(value);
      return index;
    });

    const results = await allSettledGroupedWithConcurrency(
      tasks,
      ["b", "a", "b", "a", "c"],
      { groupConcurrency: 2, taskConcurrency: 1 },
    );

    expect(results.map((result) => result.status === "fulfilled" && result.value))
      .toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs one group's tasks past its own cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await settle(10);
      inFlight -= 1;
    });

    await allSettledGroupedWithConcurrency(
      tasks,
      ["one-user", "one-user", "one-user", "one-user", "one-user", "one-user"],
      { groupConcurrency: 5, taskConcurrency: 2 },
    );

    expect(peak).toBe(2);
  });

  it("lets other groups finish while a large group is still working", async () => {
    const finished: string[] = [];
    const slowGroup = Array.from({ length: 8 }, (_unused, index) => async () => {
      await settle(15);
      finished.push(`slow-${index}`);
    });
    const fastTask = async () => {
      await settle(1);
      finished.push("fast");
    };

    await allSettledGroupedWithConcurrency(
      [...slowGroup, fastTask],
      [...slowGroup.map(() => "hog"), "small"],
      { groupConcurrency: 2, taskConcurrency: 1 },
    );

    expect(finished.indexOf("fast")).toBeLessThan(finished.indexOf("slow-2"));
  });

  it("isolates one task's rejection to its own settlement", async () => {
    const results = await allSettledGroupedWithConcurrency(
      [
        () => Promise.resolve("first"),
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve("third"),
      ],
      ["a", "a", "b"],
      { groupConcurrency: 2, taskConcurrency: 2 },
    );

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled", "rejected", "fulfilled",
    ]);
  });
});
