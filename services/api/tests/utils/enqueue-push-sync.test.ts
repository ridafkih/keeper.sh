import { describe, expect, it } from "vitest";
import { runEnqueuePushSync } from "../../src/utils/enqueue-push-sync";
import type { EnqueuePushSyncDependencies, PushSyncQueue } from "../../src/utils/enqueue-push-sync";
import type { PushSyncJobPayload } from "@keeper.sh/queue";

interface AddedJob {
  name: string;
  data: PushSyncJobPayload;
  options: {
    jobId: string;
    removeOnComplete: boolean;
    removeOnFail: boolean;
  };
}

const createMockQueue = (): { queue: PushSyncQueue; addedJobs: AddedJob[]; closed: boolean } => {
  const state = { addedJobs: [] as AddedJob[], closed: false };

  const queue: PushSyncQueue = {
    add: (name, data, options) => {
      state.addedJobs.push({ name, data, options });
      return Promise.resolve();
    },
    close: () => {
      state.closed = true;
      return Promise.resolve();
    },
  };

  return { queue, get addedJobs() { return state.addedJobs; }, get closed() { return state.closed; } };
};

const createDependencies = (
  queue: PushSyncQueue,
  correlationId: string,
  destinationCalendarIds = ["calendar-1"],
): EnqueuePushSyncDependencies => ({
  createQueue: () => queue,
  generateCorrelationId: () => correlationId,
  getDestinationCalendarIds: () => Promise.resolve(destinationCalendarIds),
});

describe("runEnqueuePushSync", () => {
  it("enqueues a job with the correct name and payload", async () => {
    const mock = createMockQueue();
    const dependencies = createDependencies(mock.queue, "correlation-123");

    await runEnqueuePushSync("user-42", "pro", dependencies);

    expect(mock.addedJobs).toHaveLength(1);
    expect(mock.addedJobs[0]).toEqual({
      name: "sync-user-42-calendar-1",
      data: {
        calendarId: "calendar-1",
        userId: "user-42",
        plan: "pro",
        correlationId: "correlation-123",
      },
      options: {
        jobId: "sync-user-42-calendar-1-correlation-123",
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  });

  it("uses the provided plan in the job payload", async () => {
    const mock = createMockQueue();
    const dependencies = createDependencies(mock.queue, "correlation-456");

    await runEnqueuePushSync("user-1", "free", dependencies);

    expect(mock.addedJobs[0]?.data.plan).toBe("free");
  });

  it("closes the queue after enqueuing", async () => {
    const mock = createMockQueue();
    const dependencies = createDependencies(mock.queue, "correlation-789");

    await runEnqueuePushSync("user-1", "free", dependencies);

    expect(mock.closed).toBe(true);
  });

  it("closes the queue even when add fails", async () => {
    let closeCalled = false;

    const failingQueue: PushSyncQueue = {
      add: () => Promise.reject(new Error("queue unavailable")),
      close: () => {
        closeCalled = true;
        return Promise.resolve();
      },
    };
    try {
      await runEnqueuePushSync("user-1", "free", createDependencies(failingQueue, "id"));
    } catch {
      // Expected
    }

    expect(closeCalled).toBe(true);
  });

  it("propagates the error from a failed add", async () => {
    const failingQueue: PushSyncQueue = {
      add: () => Promise.reject(new Error("queue unavailable")),
      close: () => Promise.resolve(),
    };

    await expect(
      runEnqueuePushSync("user-1", "free", createDependencies(failingQueue, "id")),
    ).rejects.toThrow("queue unavailable");
  });

  it("generates a unique correlation ID per enqueue via the dependency", async () => {
    const mock = createMockQueue();
    let callCount = 0;
    const dependencies: EnqueuePushSyncDependencies = {
      createQueue: () => mock.queue,
      generateCorrelationId: () => {
        callCount += 1;
        return `correlation-${callCount}`;
      },
      getDestinationCalendarIds: () => Promise.resolve(["calendar-1"]),
    };

    await runEnqueuePushSync("user-1", "free", dependencies);
    await runEnqueuePushSync("user-2", "pro", dependencies);

    expect(mock.addedJobs[0]?.data.correlationId).toBe("correlation-1");
    expect(mock.addedJobs[1]?.data.correlationId).toBe("correlation-2");
  });

  it("formats the job name with the user and destination calendar", async () => {
    const mock = createMockQueue();
    const dependencies = createDependencies(mock.queue, "id");

    await runEnqueuePushSync("user-abc-123", "free", dependencies);

    expect(mock.addedJobs[0]?.name).toBe("sync-user-abc-123-calendar-1");
  });

  it("enqueues every destination as an independent job", async () => {
    const mock = createMockQueue();
    const dependencies = createDependencies(
      mock.queue,
      "correlation-multi",
      ["calendar-1", "calendar-2"],
    );

    await runEnqueuePushSync("user-1", "pro", dependencies);

    expect(mock.addedJobs.map(({ data }) => data.calendarId)).toEqual([
      "calendar-1",
      "calendar-2",
    ]);
  });

  it("does not open a queue when the user has no destinations", async () => {
    let createQueueCalled = false;
    const dependencies: EnqueuePushSyncDependencies = {
      createQueue: () => {
        createQueueCalled = true;
        return createMockQueue().queue;
      },
      generateCorrelationId: () => "correlation-empty",
      getDestinationCalendarIds: () => Promise.resolve([]),
    };

    await runEnqueuePushSync("user-1", "pro", dependencies);

    expect(createQueueCalled).toBe(false);
  });
});
