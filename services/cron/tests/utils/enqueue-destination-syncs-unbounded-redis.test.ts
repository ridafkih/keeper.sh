import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * The ingest-sources cron callback awaits enqueueDestinationSyncsForUsers before
 * it returns, and cronbake re-arms the job only after the callback settles. The
 * production wiring opens a BullMQ queue with maxRetriesPerRequest: null and no
 * commandTimeout, so a Redis endpoint that accepts the TCP connection but never
 * answers (a half-open socket, or an outage behind a load balancer) leaves
 * queue.getJob / queue.addBulk pending forever — parking the serial ingest pass
 * with no bound. This suite points the real wiring at exactly such an endpoint
 * and requires the enqueue to settle (resolve OR reject) within a generous
 * bound far above the 10s commandTimeout every other Redis client in this
 * service already carries.
 */

const testState = vi.hoisted(() => ({ redisUrl: "" }));

vi.mock("@/env", () => ({
  default: {
    get REDIS_URL(): string {
      return testState.redisUrl;
    },
    WORKER_JOB_QUEUE_ENABLED: true,
  },
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    set: () => null,
  },
}));

vi.mock("@/context", () => ({
  database: {
    select: () => ({
      /*
       * A real promise (awaited directly by getPendingRequests: no pending
       * requests) augmented with `where` (chained by getDestinations: one
       * push-capable pro destination).
       */
      from: () =>
        Object.assign(Promise.resolve([]), {
          where: () => Promise.resolve([{ calendarId: "cal-1", userId: "user-1" }]),
        }),
    }),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
  },
  premiumService: {
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

const sockets: Socket[] = [];
let blackHoleServer: Server | null = null;

beforeAll(async () => {
  // A Redis endpoint that accepts connections and then never sends a byte.
  blackHoleServer = createServer((socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => {
    blackHoleServer?.listen(0, "127.0.0.1", resolve);
  });
  const address = blackHoleServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Black-hole server has no port");
  }
  testState.redisUrl = `redis://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    if (!blackHoleServer) {
      resolve();
      return;
    }
    blackHoleServer.close(() => resolve());
  });
});

describe("enqueueDestinationSyncsForUsers against an unresponsive Redis", () => {
  it("settles within a bound instead of parking the serial ingest pass forever", async () => {
    const { enqueueDestinationSyncsForUsers } = await import("@/utils/enqueue-destination-syncs");

    const outcome = await Promise.race([
      enqueueDestinationSyncsForUsers(["user-1"]).then(
        () => "settled",
        () => "settled",
      ),
      new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("still pending after 15s"), 15_000);
        timer.unref?.();
      }),
    ]);

    expect(outcome).toBe("settled");
  }, 30_000);
});
