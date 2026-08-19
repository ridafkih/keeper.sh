import { describe, expect, it } from "vitest";
import { allSettledGroupedWithConcurrency } from "@keeper.sh/calendar";

const settle = async (
  calendarCount: number,
  taskConcurrency: number,
): Promise<number> => {
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: calendarCount }, () => async () => {
    running++;
    peak = Math.max(peak, running);
    await Promise.resolve();
    running--;
    return null;
  });
  await allSettledGroupedWithConcurrency(
    tasks,
    Array.from({ length: calendarCount }, () => "one-user"),
    { groupConcurrency: 100_000, taskConcurrency },
  );
  return peak;
};

describe("one person's calendars in a single pass", () => {
  it("no longer makes a calendar wait for its owner's other calendars", async () => {
    await expect(settle(6, 100_000)).resolves.toBe(6);
  });

  it("would have queued them two at a time under the old budget", async () => {
    await expect(settle(6, 2)).resolves.toBe(2);
  });
});
