import { describe, expect, it } from "vitest";
import { removeUserSyncJobs } from "../src/index";

interface FakeQueueStore {
  queue: { remove: (jobId: string) => Promise<number> };
  removeAttempts: string[];
  remaining: Set<string>;
}

const createFakeQueueStore = (
  jobIds: string[],
  failures: Record<string, Error> = {},
): FakeQueueStore => {
  const remaining = new Set(jobIds);
  const removeAttempts: string[] = [];

  return {
    remaining,
    removeAttempts,
    queue: {
      remove: (jobId: string) => {
        removeAttempts.push(jobId);

        const failure = failures[jobId];
        if (failure) {
          return Promise.reject(failure);
        }

        return Promise.resolve(Number(remaining.delete(jobId)));
      },
    },
  };
};

describe("removeUserSyncJobs", () => {
  it("attempts removal of every sync job belonging to the deleted user", async () => {
    const store = createFakeQueueStore([
      "sync-user-1-cal-a",
      "sync-user-1-cal-b",
      "sync-user-2-cal-c",
    ]);

    const outcome = await removeUserSyncJobs(store.queue as never, "user-1", [
      "cal-a",
      "cal-b",
    ]);

    expect(store.removeAttempts.toSorted()).toEqual([
      "sync-user-1-cal-a",
      "sync-user-1-cal-b",
    ]);
    expect(outcome.removedJobIds.toSorted()).toEqual([
      "sync-user-1-cal-a",
      "sync-user-1-cal-b",
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it("leaves an unrelated user's queued jobs in place", async () => {
    const store = createFakeQueueStore([
      "sync-user-1-cal-a",
      "sync-user-2-cal-c",
    ]);

    await removeUserSyncJobs(store.queue as never, "user-1", ["cal-a"]);

    expect([...store.remaining]).toEqual(["sync-user-2-cal-c"]);
  });

  it("reports a removal failure without abandoning the user's other jobs", async () => {
    const failure = new Error("job is locked by an active worker");
    const store = createFakeQueueStore(
      ["sync-user-1-cal-a", "sync-user-1-cal-b"],
      { "sync-user-1-cal-a": failure },
    );

    const outcome = await removeUserSyncJobs(store.queue as never, "user-1", [
      "cal-a",
      "cal-b",
    ]);

    expect(store.removeAttempts.toSorted()).toEqual([
      "sync-user-1-cal-a",
      "sync-user-1-cal-b",
    ]);
    expect(outcome.removedJobIds).toEqual(["sync-user-1-cal-b"]);
    expect(outcome.failures).toEqual([
      { jobId: "sync-user-1-cal-a", message: "job is locked by an active worker" },
    ]);
    expect([...store.remaining]).toEqual(["sync-user-1-cal-a"]);
  });
});
