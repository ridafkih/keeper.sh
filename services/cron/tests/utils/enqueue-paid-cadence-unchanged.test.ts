import { describe, expect, it, vi } from "vitest";
import {
  runEnqueueDestinationSyncsForUsers,
  type DestinationSyncQueue,
  type EnqueueDestinationSyncDependencies,
} from "../../src/utils/enqueue-destination-syncs-core";

/*
 * The immediate push for a newly connected calendar arrives through the pending-request
 * path, so the eligibility filter itself must stay exactly as narrow as it is today.
 */
interface Harness {
  addBulk: ReturnType<typeof vi.fn<DestinationSyncQueue["addBulk"]>>;
  dependencies: EnqueueDestinationSyncDependencies;
}

const createHarness = (
  plan: "free" | "pro",
  pendingRequests: { requestId: string; requestedAt: Date; userId: string }[],
): Harness => {
  const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());
  return {
    addBulk,
    dependencies: {
      acknowledgePendingRequests: () => Promise.resolve(),
      createQueue: () => ({
        addBulk,
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "subject-user" },
      ]),
      getPendingRequests: () => Promise.resolve(pendingRequests),
      resolvePlan: () => Promise.resolve(plan),
    },
  };
};

const pendingRequest = {
  requestId: "request-1",
  requestedAt: new Date("2026-08-18T00:00:00.000Z"),
  userId: "subject-user",
};

describe("the paid cadence is unchanged", () => {
  it("builds no jobs for a free user with no pending request", async () => {
    const harness = createHarness("free", []);

    await expect(runEnqueueDestinationSyncsForUsers(
      ["subject-user"],
      harness.dependencies,
    )).resolves.toBe(0);

    expect(harness.addBulk).not.toHaveBeenCalled();
  });

  it("builds jobs for a free user with a pending request", async () => {
    const harness = createHarness("free", [pendingRequest]);

    await expect(runEnqueueDestinationSyncsForUsers(
      [],
      harness.dependencies,
    )).resolves.toBe(1);

    expect(harness.addBulk).toHaveBeenCalledOnce();
  });

  it("builds jobs for a pro user with no pending request", async () => {
    const harness = createHarness("pro", []);

    await expect(runEnqueueDestinationSyncsForUsers(
      ["subject-user"],
      harness.dependencies,
    )).resolves.toBe(1);

    expect(harness.addBulk).toHaveBeenCalledOnce();
  });

  it("filters a free user out again once their request has been acknowledged", async () => {
    const store = new Map([["subject-user", pendingRequest]]);
    const enqueuedTicks: number[] = [];

    for (const tick of [0, 1]) {
      const harness = createHarness("free", [...store.values()]);
      await runEnqueueDestinationSyncsForUsers(["subject-user"], {
        ...harness.dependencies,
        acknowledgePendingRequests: (requests) => {
          for (const request of requests) {
            store.delete(request.userId);
          }
          return Promise.resolve();
        },
        createQueue: () => ({
          addBulk: (jobs) => {
            if (jobs.length > 0) {
              enqueuedTicks.push(tick);
            }
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
          getJob: () => Promise.resolve(null),
        }),
      });
    }

    expect(enqueuedTicks).toEqual([0]);
  });
});
