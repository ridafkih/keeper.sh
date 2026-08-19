import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { createPushSyncQueue } from "@keeper.sh/queue";

/*
 * The enqueue's finally block fire-and-forgets queue.disconnect() so that a
 * timed-out run "force-disconnects" the ioredis connection and it "stops
 * reconnecting forever". But BullMQ's RedisConnection.disconnect() begins with
 * `const client = await this.client`, and `client` is the `initializing`
 * promise that only resolves once ioredis emits "ready". Against a Redis
 * endpoint that accepts TCP and never answers — exactly the scenario the 10s
 * enqueue timeout exists for — "ready" never fires, so the disconnect parks
 * forever before reaching client.disconnect(), and the abandoned ioredis
 * client keeps its reconnect loop alive. This suite drives the real enqueue
 * wiring at such an endpoint and requires the underlying ioredis client to
 * actually reach "end" shortly after the enqueue settles.
 */

const testState = vi.hoisted(() => ({
  createdQueues: [] as object[],
  redisUrl: "",
}));

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

vi.mock("@keeper.sh/queue", async (importOriginal) => {
  const actual = await importOriginal<{ createPushSyncQueue: typeof createPushSyncQueue }>();
  const wrappedCreatePushSyncQueue: typeof createPushSyncQueue = (connection) => {
    const queue = actual.createPushSyncQueue(connection);
    testState.createdQueues.push(queue);
    return queue;
  };
  return {
    ...actual,
    createPushSyncQueue: wrappedCreatePushSyncQueue,
  };
});

interface QueueInternals {
  connection: {
    _client?: {
      status: string;
    };
  };
}

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
  // Abandon the leaked clients so vitest can exit even while the bug stands.
  for (const queue of testState.createdQueues) {
    const client = (queue as QueueInternals).connection._client;
    (client as unknown as { disconnect?: () => void })?.disconnect?.();
  }
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

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

describe("enqueue force-disconnect against an unresponsive Redis", () => {
  it("tears down the ioredis client after the enqueue timeout", async () => {
    const { enqueueDestinationSyncsForUsers } = await import("@/utils/enqueue-destination-syncs");

    await enqueueDestinationSyncsForUsers(["user-1"]).catch(() => null);

    expect(testState.createdQueues.length).toBeGreaterThan(0);

    /*
     * The finally block has already fired queue.disconnect() by now. Give the
     * teardown a generous grace window, then require every abandoned client to
     * have actually left the connect/reconnect cycle.
     */
    const deadline = Date.now() + 5000;
    let statuses: string[] = [];
    while (Date.now() < deadline) {
      statuses = testState.createdQueues.map((queue) => {
        const client = (queue as QueueInternals).connection._client;
        if (!client) {
          return "no-client";
        }
        return client.status;
      });
      if (statuses.every((status) => status === "end" || status === "close")) {
        break;
      }
      await sleep(100);
    }

    expect(statuses).toEqual(statuses.map(() => "end"));
  }, 30_000);
});
