import { describe, expect, it, vi } from "vitest";
import {
  runEnqueueDestinationSyncsForUsers,
  type DestinationSyncQueue,
} from "../../src/utils/enqueue-destination-syncs-core";

describe("runEnqueueDestinationSyncsForUsers", () => {
  it("enqueues affected Pro users immediately and leaves free users on their cadence", async () => {
    const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());
    const close = vi.fn<DestinationSyncQueue["close"]>(() => Promise.resolve());
    const getJob = vi.fn<DestinationSyncQueue["getJob"]>(() => Promise.resolve(null));
    const getDestinations = vi.fn(() => Promise.resolve([
      { calendarId: "destination-free", userId: "free-user" },
      { calendarId: "destination-pro", userId: "pro-user" },
    ]));

    await expect(runEnqueueDestinationSyncsForUsers(
      ["pro-user", "free-user", "pro-user"],
      {
        createQueue: () => ({ addBulk, close, getJob }),
        enabled: true,
        generateCorrelationId: () => "correlation-1",
        getDestinations,
        resolvePlan: (userId) => {
          if (userId === "pro-user") {
            return Promise.resolve("pro");
          }
          return Promise.resolve("free");
        },
      },
    )).resolves.toBe(1);

    expect(getDestinations).toHaveBeenCalledWith(["free-user", "pro-user"]);
    expect(addBulk).toHaveBeenCalledOnce();
    const jobs = addBulk.mock.calls[0]?.[0];
    expect(jobs?.map((job) => job.data)).toEqual([
      {
        calendarId: "destination-pro",
        correlationId: "correlation-1",
        plan: "pro",
        trigger: "cron",
        userId: "pro-user",
      },
    ]);
    expect(jobs?.map((job) => job.opts.jobId)).toEqual([
      "sync-pro-user-destination-pro",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not query or create a queue when worker enqueuing is disabled", async () => {
    const createQueue = vi.fn();
    const getDestinations = vi.fn();

    await expect(runEnqueueDestinationSyncsForUsers(["user-1"], {
      createQueue,
      enabled: false,
      generateCorrelationId: () => "unused",
      getDestinations,
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(0);

    expect(getDestinations).not.toHaveBeenCalled();
    expect(createQueue).not.toHaveBeenCalled();
  });

  it("drains durable requests and acknowledges them only after enqueue succeeds", async () => {
    const pendingRequests = [{
      requestId: "request-1",
      requestedAt: new Date("2026-08-11T00:00:00.000Z"),
      userId: "pending-user",
    }];
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());
    const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests,
      createQueue: () => ({
        addBulk,
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "pending-user" },
      ]),
      getPendingRequests: () => Promise.resolve(pendingRequests),
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(1);

    expect(acknowledgePendingRequests).toHaveBeenCalledWith(pendingRequests);
  });

  it("enqueues a durable request immediately for a free user", async () => {
    const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests: () => Promise.resolve(),
      createQueue: () => ({
        addBulk,
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "free-user" },
      ]),
      getPendingRequests: () => Promise.resolve([
        {
          requestId: "request-1",
          requestedAt: new Date("2026-08-11T00:00:00.000Z"),
          userId: "free-user",
        },
      ]),
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(1);

    expect(addBulk).toHaveBeenCalledOnce();
  });

  it("retains a durable request when its user's job was deduped by an older in-flight job", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());
    const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());
    const getJob = vi.fn<DestinationSyncQueue["getJob"]>((jobId) => {
      if (jobId === "sync-deduped-user-destination-1") {
        return Promise.resolve({ timestamp: requestedAt.getTime() - 1000 });
      }
      return Promise.resolve(null);
    });

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests,
      createQueue: () => ({ addBulk, close: () => Promise.resolve(), getJob }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "deduped-user" },
        { calendarId: "destination-1", userId: "fresh-user" },
      ]),
      getPendingRequests: () => Promise.resolve([
        { requestId: "request-1", requestedAt, userId: "deduped-user" },
        { requestId: "request-2", requestedAt, userId: "fresh-user" },
      ]),
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(2);

    expect(addBulk).toHaveBeenCalledOnce();
    expect(acknowledgePendingRequests).toHaveBeenCalledWith([
      { requestId: "request-2", requestedAt, userId: "fresh-user" },
    ]);
  });

  it("retains a durable request when any of its user's destination jobs was deduped", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());
    const getJob = vi.fn<DestinationSyncQueue["getJob"]>((jobId) => {
      if (jobId === "sync-pending-user-destination-2") {
        return Promise.resolve({ timestamp: requestedAt.getTime() - 1000 });
      }
      return Promise.resolve(null);
    });

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests,
      createQueue: () => ({
        addBulk: () => Promise.resolve(),
        close: () => Promise.resolve(),
        getJob,
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "pending-user" },
        { calendarId: "destination-2", userId: "pending-user" },
      ]),
      getPendingRequests: () => Promise.resolve([
        { requestId: "request-1", requestedAt, userId: "pending-user" },
      ]),
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(2);

    expect(acknowledgePendingRequests).toHaveBeenCalledWith([]);
  });

  it("acknowledges a deduped request when the in-flight job already covers it", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const pendingRequests = [{ requestId: "request-1", requestedAt, userId: "free-user" }];
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests,
      createQueue: () => ({
        addBulk: () => Promise.resolve(),
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve({ timestamp: requestedAt.getTime() + 1000 }),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "free-user" },
      ]),
      getPendingRequests: () => Promise.resolve(pendingRequests),
      resolvePlan: () => Promise.resolve("free"),
    })).resolves.toBe(1);

    expect(acknowledgePendingRequests).toHaveBeenCalledWith(pendingRequests);
  });

  it("does not keep a free user on the Pro cadence when their sync always outlives the tick", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const store = new Map([
      ["free-user", { requestId: "request-1", requestedAt, userId: "free-user" }],
    ]);
    const enqueuedTicks: number[] = [];

    for (const tick of [0, 1, 2, 3, 4, 5]) {
      // Every tick finds a fresh in-flight job replacing the last.
      // Only the job seen on the first tick predates the request.
      const inFlightJob = { timestamp: requestedAt.getTime() + (tick * 60_000) - 60_000 };
      await runEnqueueDestinationSyncsForUsers([], {
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
          getJob: () => Promise.resolve(inFlightJob),
        }),
        enabled: true,
        generateCorrelationId: () => "correlation-1",
        getDestinations: () => Promise.resolve([
          { calendarId: "destination-1", userId: "free-user" },
        ]),
        getPendingRequests: () => Promise.resolve([...store.values()]),
        resolvePlan: () => Promise.resolve("free"),
      });
    }

    expect(enqueuedTicks).toEqual([0, 1]);
    expect(store.size).toBe(0);
  });

  it("retries a retained request on the next tick once the in-flight job finishes", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const inFlightJob = { timestamp: requestedAt.getTime() - 60_000 };
    const jobFinishesAtTick = 3;
    const store = new Map([
      ["free-user", { requestId: "request-1", requestedAt, userId: "free-user" }],
    ]);
    const enqueuedTicks: number[] = [];

    for (const tick of [0, 1, 2, 3, 4, 5]) {
      await runEnqueueDestinationSyncsForUsers([], {
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
          getJob: () => {
            if (tick < jobFinishesAtTick) {
              return Promise.resolve(inFlightJob);
            }
            return Promise.resolve(null);
          },
        }),
        enabled: true,
        generateCorrelationId: () => "correlation-1",
        getDestinations: () => Promise.resolve([
          { calendarId: "destination-1", userId: "free-user" },
        ]),
        getPendingRequests: () => Promise.resolve([...store.values()]),
        resolvePlan: () => Promise.resolve("free"),
      });
    }

    expect(enqueuedTicks).toEqual([0, 1, 2, 3]);
    expect(store.size).toBe(0);
  });

  it("acknowledges a covered Pro request without disturbing the Pro cadence", async () => {
    const requestedAt = new Date("2026-08-11T00:05:00.000Z");
    const store = new Map([
      ["pro-user", { requestId: "request-1", requestedAt, userId: "pro-user" }],
    ]);
    const enqueuedTicks: number[] = [];

    for (const tick of [0, 1, 2]) {
      await runEnqueueDestinationSyncsForUsers(["pro-user"], {
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
          getJob: () => Promise.resolve({ timestamp: requestedAt.getTime() + 1000 }),
        }),
        enabled: true,
        generateCorrelationId: () => "correlation-1",
        getDestinations: () => Promise.resolve([
          { calendarId: "destination-1", userId: "pro-user" },
        ]),
        getPendingRequests: () => Promise.resolve([...store.values()]),
        resolvePlan: () => Promise.resolve("pro"),
      });
    }

    expect(enqueuedTicks).toEqual([0, 1, 2]);
    expect(store.size).toBe(0);
  });

  it("retains durable requests when enqueue fails", async () => {
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());

    await expect(runEnqueueDestinationSyncsForUsers([], {
      acknowledgePendingRequests,
      createQueue: () => ({
        addBulk: () => Promise.reject(new Error("redis unavailable")),
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "pending-user" },
      ]),
      getPendingRequests: () => Promise.resolve([
        {
          requestId: "request-1",
          requestedAt: new Date("2026-08-11T00:00:00.000Z"),
          userId: "pending-user",
        },
      ]),
      resolvePlan: () => Promise.resolve("free"),
    })).rejects.toThrow("redis unavailable");

    expect(acknowledgePendingRequests).not.toHaveBeenCalled();
  });

  it("does not require a plan for a pending user with no destinations", async () => {
    const pendingRequests = [{
      requestId: "request-1",
      requestedAt: new Date("2026-08-11T00:00:00.000Z"),
      userId: "deleted-user",
    }];
    const acknowledgePendingRequests = vi.fn(() => Promise.resolve());
    const resolvePlan = vi.fn((userId: string) => {
      if (userId === "active-user") {
        return Promise.resolve<"pro">("pro");
      }
      return Promise.resolve(null);
    });

    await expect(runEnqueueDestinationSyncsForUsers(["active-user"], {
      acknowledgePendingRequests,
      createQueue: () => ({
        addBulk: () => Promise.resolve(),
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-1",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-1", userId: "active-user" },
      ]),
      getPendingRequests: () => Promise.resolve(pendingRequests),
      resolvePlan,
    })).resolves.toBe(1);

    expect(resolvePlan).toHaveBeenCalledOnce();
    expect(resolvePlan).toHaveBeenCalledWith("active-user");
    expect(acknowledgePendingRequests).toHaveBeenCalledWith(pendingRequests);
  });
});
