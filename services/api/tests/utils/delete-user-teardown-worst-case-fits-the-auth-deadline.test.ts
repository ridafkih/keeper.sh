import { describe, expect, it, vi } from "vitest";
import { SYNC_TEARDOWN_TIMEOUT_MS } from "@keeper.sh/auth";

const REQUIRED_HEADROOM_MS = 1000;

const hangForever = (): Promise<never> => Promise.race([]);

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

vi.mock("@/context", () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "cal1" }]),
      }),
    }),
  },
  env: { REDIS_URL: "redis://localhost:6379" },
  redis: { set: () => Promise.resolve("OK") },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: null,
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  markUserDeleted: () => hangForever(),
}));

vi.mock("@keeper.sh/queue", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPushSyncQueue: () => ({
    getJob: () => Promise.resolve(),
    remove: () => Promise.resolve(0),
  }),
  removeUserSyncJobs: () => hangForever(),
}));

const everyStepHangingRun = () => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: () => hangForever(),
  fetchImpl: () => hangForever(),
  listCalendarIds: () => Promise.resolve(["cal1"]),
  listOAuthCredentials: () => hangForever(),
  listPushChannels: () => Promise.resolve([]),
  redis: { set: () => Promise.resolve("OK") },
  residue: {
    clear: () => Promise.resolve(),
    delete: () => Promise.resolve(0),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  },
});

describe("delete user teardown worst case against the auth deadline", () => {
  it(
    "finishes with a full second of headroom under the auth deadline when every step hangs",
    async () => {
      const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
      const teardown = createDeleteUserSyncTeardown(everyStepHangingRun() as never);

      const startedAt = Date.now();
      await teardown("user-a");
      const elapsedMs = Date.now() - startedAt;

      expect({
        elapsedMs,
        keepsHeadroom: elapsedMs <= SYNC_TEARDOWN_TIMEOUT_MS - REQUIRED_HEADROOM_MS,
      }).toEqual({
        elapsedMs: expect.any(Number),
        keepsHeadroom: true,
      });
    },
    30_000,
  );
});
