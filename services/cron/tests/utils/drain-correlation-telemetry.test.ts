import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, widelog } from "../../src/utils/logging";
import {
  runEnqueueDestinationSyncsForUsers,
  type DestinationSyncQueue,
} from "../../src/utils/enqueue-destination-syncs-core";

interface EmittedEvent {
  correlation?: { id?: string };
  operation?: { name?: string };
  push_drain?: { jobs_enqueued?: number };
}

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const enqueueInsideDrainTick = async (trigger: "cron" | "push"): Promise<EmittedEvent> => {
  const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());
  const close = vi.fn<DestinationSyncQueue["close"]>(() => Promise.resolve());
  const getJob = vi.fn<DestinationSyncQueue["getJob"]>(() => Promise.resolve(null));

  await context(async () => {
    widelog.set("operation.name", "drain-pending-ingest");
    await runEnqueueDestinationSyncsForUsers(["pro-user"], {
      createQueue: () => ({ addBulk, close, getJob }),
      enabled: true,
      generateCorrelationId: () => "correlation-9",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-a", userId: "pro-user" },
        { calendarId: "destination-b", userId: "pro-user" },
      ]),
      resolvePlan: () => Promise.resolve("pro"),
    }, trigger);
    widelog.flush();
  });

  const event = emitted.find((candidate) =>
    candidate.operation?.name === "drain-pending-ingest");
  if (!event) {
    throw new Error("no drain wide event was emitted");
  }
  return event;
};

describe("destination enqueue telemetry at the producing end", () => {
  it("logs the correlation id it stamped into every payload", async () => {
    const event = await enqueueInsideDrainTick("push");

    expect(event.correlation?.id).toBe("correlation-9");
    expect(event.push_drain?.jobs_enqueued).toBe(2);
  });

  it("carries the trigger into the payload the worker will read", async () => {
    const addBulk = vi.fn<DestinationSyncQueue["addBulk"]>(() => Promise.resolve());

    await runEnqueueDestinationSyncsForUsers(["pro-user"], {
      createQueue: () => ({
        addBulk,
        close: () => Promise.resolve(),
        getJob: () => Promise.resolve(null),
      }),
      enabled: true,
      generateCorrelationId: () => "correlation-10",
      getDestinations: () => Promise.resolve([
        { calendarId: "destination-a", userId: "pro-user" },
      ]),
      resolvePlan: () => Promise.resolve("pro"),
    }, "push");

    expect(addBulk.mock.calls[0]?.[0]?.map((job) => job.data.trigger)).toEqual(["push"]);
  });
});
