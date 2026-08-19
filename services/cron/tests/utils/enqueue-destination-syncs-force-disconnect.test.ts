import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { createPushSyncQueue } from "@keeper.sh/queue";

/*
 * BullMQ's RedisConnection.disconnect() starts with `await this.client`, a
 * promise that only settles once ioredis emits "ready". Against an endpoint
 * that accepts TCP and never answers — the case the enqueue timeout exists
 * for — the disconnect parks before it ever closes the socket, leaving the
 * abandoned client's reconnect loop running.
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
  // Close leaked clients by hand, or vitest cannot exit while the bug stands.
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
