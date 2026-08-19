import { describe, expect, it } from "vitest";
import { buildPushDestinationJobs } from "../../src/utils/push-destination-jobs";

const destinations = [{ calendarId: "google", userId: "user-1" }];

const prioritiesFor = (trigger: "cron" | "push"): (number | undefined)[] =>
  buildPushDestinationJobs(destinations, "pro", "run-1", trigger)
    .map(({ opts }) => opts.priority);

describe("buildPushDestinationJobs priority", () => {
  it("gives push-triggered jobs a lane ahead of rotation-triggered jobs", () => {
    const [pushPriority] = prioritiesFor("push");
    const [cronPriority] = prioritiesFor("cron");

    expect(typeof pushPriority).toBe("number");
    expect(typeof cronPriority).toBe("number");
    expect(pushPriority).toBeLessThan(cronPriority as number);
  });

  it("keeps both lanes inside BullMQ's prioritized set so neither falls back to unprioritized FIFO", () => {
    const [pushPriority] = prioritiesFor("push");
    const [cronPriority] = prioritiesFor("cron");

    expect(pushPriority).toBeGreaterThan(0);
    expect(cronPriority).toBeGreaterThan(0);
  });
});
