import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Cronbake re-arms the ingest job only after its callback settles, so the
 * enqueue must be bounded: with BullMQ's maxRetriesPerRequest: null and no
 * commandTimeout, a Redis endpoint that accepts TCP but never answers parks
 * the serial ingest pass forever. The 15s bound sits far above the 10s
 * commandTimeout every other Redis client in this service carries.
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
    errorFields: () => null,
    set: () => null,
  },
}));

vi.mock("@/context", () => ({
  database: {
    select: () => ({
      /* Awaited directly by getPendingRequests, chained with `where` by getDestinations. */
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
