import { describe, expect, it } from "vitest";
import {
  runEnqueueDestinationSyncsForUsers,
  type EnqueueDestinationSyncDependencies,
} from "../../src/utils/enqueue-destination-syncs-core";

/*
 * Moving the enqueue from one post-batch call to one call per finished calendar changes
 * only when a user is pushed, never which users are pushable, so the eligibility filter is
 * pinned against both call shapes rather than against the batched shape alone.
 */
const planByUserId: Record<string, "free" | "pro"> = {
  "free-idle": "free",
  "free-requested": "free",
  "pro-user": "pro",
};

const calendarIdByUserId: Record<string, string> = {
  "free-idle": "calendar-free-idle",
  "free-requested": "calendar-free-requested",
  "pro-user": "calendar-pro",
};

const pendingRequest = {
  requestId: "request-1",
  requestedAt: new Date("2026-08-18T00:00:00.000Z"),
  userId: "free-requested",
};

interface Harness {
  dependencies: EnqueueDestinationSyncDependencies;
  enqueuedUserIds: string[];
}

const createHarness = (): Harness => {
  const enqueuedUserIds: string[] = [];
  const outstandingRequests = new Map([[pendingRequest.userId, pendingRequest]]);
  const dependencies: EnqueueDestinationSyncDependencies = {
    acknowledgePendingRequests: (requests) => {
      for (const request of requests) {
        outstandingRequests.delete(request.userId);
      }
      return Promise.resolve();
    },
    createQueue: () => ({
      addBulk: (jobs) => {
        for (const job of jobs) {
          enqueuedUserIds.push(job.data.userId);
        }
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
      getJob: () => Promise.resolve(null),
    }),
    enabled: true,
    generateCorrelationId: () => "correlation-1",
    getDestinations: (userIds) =>
      Promise.resolve(userIds.map((userId) => ({
        calendarId: calendarIdByUserId[userId] ?? `calendar-${userId}`,
        userId,
      }))),
    getPendingRequests: () => Promise.resolve([...outstandingRequests.values()]),
    resolvePlan: (userId) => Promise.resolve(planByUserId[userId] ?? "free"),
  };
  return { dependencies, enqueuedUserIds };
};

describe("the paid cadence is still not loosened", () => {
  it("pushes only the pro user and the free user holding a request in one batch", async () => {
    const harness = createHarness();

    await expect(runEnqueueDestinationSyncsForUsers(
      ["free-idle", "free-requested", "pro-user"],
      harness.dependencies,
    )).resolves.toBe(2);

    expect(harness.enqueuedUserIds.toSorted()).toEqual(["free-requested", "pro-user"]);
  });

  it("pushes the same set when each calendar enqueues on its own completion", async () => {
    const harness = createHarness();

    for (const userId of ["free-idle", "free-requested", "pro-user"]) {
      await runEnqueueDestinationSyncsForUsers([userId], harness.dependencies);
    }

    expect(harness.enqueuedUserIds.toSorted()).toEqual(["free-requested", "pro-user"]);
  });

  it("keeps a free user out on a per-calendar enqueue that follows their acknowledged request", async () => {
    const harness = createHarness();

    await runEnqueueDestinationSyncsForUsers(["free-requested"], harness.dependencies);
    await runEnqueueDestinationSyncsForUsers(["free-requested"], harness.dependencies);

    expect(harness.enqueuedUserIds).toEqual(["free-requested"]);
  });
});
