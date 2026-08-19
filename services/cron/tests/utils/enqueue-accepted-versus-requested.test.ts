import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, widelog } from "../../src/utils/logging";
import { runEnqueueDestinationSyncsForUsers } from "../../src/utils/enqueue-destination-syncs-core";

interface EmittedEvent {
  operation?: { name?: string };
  push_drain?: {
    jobs_deduplicated?: number;
    jobs_enqueued?: number;
    jobs_requested?: number;
  };
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

describe("destination enqueue accepted versus requested", () => {
  it("reports the queue's accepted count and the deduplicated remainder", async () => {
    await context(async () => {
      widelog.set("operation.name", "drain-pending-ingest");
      await runEnqueueDestinationSyncsForUsers(["pro-user"], {
        createQueue: () => ({
          // BullMQ returns only the jobs it created; a stable id already in the queue yields nothing.
          addBulk: (jobs) => Promise.resolve(jobs.slice(0, 1)),
          close: () => Promise.resolve(),
          getJob: () => Promise.resolve(null),
        }),
        enabled: true,
        generateCorrelationId: () => "correlation-11",
        getDestinations: () => Promise.resolve([
          { calendarId: "destination-a", userId: "pro-user" },
          { calendarId: "destination-b", userId: "pro-user" },
          { calendarId: "destination-c", userId: "pro-user" },
        ]),
        resolvePlan: () => Promise.resolve("pro"),
      }, "push");
      widelog.flush();
    });

    const event = emitted.find((candidate) =>
      candidate.operation?.name === "drain-pending-ingest");

    expect(event?.push_drain?.jobs_requested).toBe(3);
    expect(event?.push_drain?.jobs_enqueued).toBe(1);
    expect(event?.push_drain?.jobs_deduplicated).toBe(2);
  });
});
