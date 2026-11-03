import { describe, expect, it } from "vitest";
import { enqueueSyncContinuation, shouldContinueAfterDeadline } from "../src/utils/sync-continuation";
import type { ContinuationQueue } from "../src/utils/sync-continuation";

const createQueue = () => {
  const added: Parameters<ContinuationQueue["add"]>[] = [];
  const queue: ContinuationQueue = {
    add: (...parameters) => {
      added.push(parameters);
      return Promise.resolve();
    },
  };
  return { added, queue };
};

const finishedJob = (continuationRequested: boolean, trigger?: "cron" | "push") => ({
  data: {
    calendarId: "calendar-1",
    correlationId: "correlation-1",
    plan: "free" as const,
    userId: "user-1",
    webhookReceivedAt: 1_700_000_000_000,
    ...(trigger && { trigger }),
  },
  returnvalue: { added: 50, addFailed: 0, continuationRequested, errors: [], removed: 0, removeFailed: 0 },
});

describe("shouldContinueAfterDeadline", () => {
  it("continues only a deadline-cut run that checkpointed operations", () => {
    expect(shouldContinueAfterDeadline({ checkpointedOperations: 50, deadlineReached: true })).toBe(true);
    expect(shouldContinueAfterDeadline({ checkpointedOperations: 0, deadlineReached: true })).toBe(false);
    expect(shouldContinueAfterDeadline({ checkpointedOperations: 50, deadlineReached: false })).toBe(false);
  });
});

describe("enqueueSyncContinuation", () => {
  it("re-adds the finished job under its stable id on its own lane, without the webhook stamp", async () => {
    const { added, queue } = createQueue();

    expect(await enqueueSyncContinuation(queue, finishedJob(true, "push"))).toBe(true);

    expect(added).toEqual([[
      "sync-user-1-calendar-1",
      { calendarId: "calendar-1", correlationId: "correlation-1", plan: "free", trigger: "push", userId: "user-1" },
      { jobId: "sync-user-1-calendar-1", priority: 1, removeOnComplete: true, removeOnFail: true },
    ]]);
  });

  it("uses the cron lane when the job carried no trigger", async () => {
    const { added, queue } = createQueue();

    await enqueueSyncContinuation(queue, finishedJob(true));

    expect(added[0]?.[2].priority).toBe(2);
  });

  it("adds nothing when the job did not ask to continue", async () => {
    const { added, queue } = createQueue();

    expect(await enqueueSyncContinuation(queue, finishedJob(false))).toBe(false);
    expect(added).toEqual([]);
  });
});
