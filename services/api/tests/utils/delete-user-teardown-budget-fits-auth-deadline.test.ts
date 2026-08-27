import { describe, expect, it, vi } from "vitest";
import { SYNC_TEARDOWN_TIMEOUT_MS } from "@keeper.sh/auth";

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

const hangingRun = () => {
  const signals = new Map<string, AbortSignal>();

  return {
    abortedStep: (stepName: string): boolean => signals.get(stepName)?.aborted === true,
    dependencies: {
      createQueue: () => ({
        getJob: () => Promise.resolve(),
        remove: () => Promise.resolve(0),
      }),
      deregisterPushChannels: (_userId: string, signal: AbortSignal) => {
        signals.set("push_channels", signal);

        return hangForever();
      },
      listCalendarIds: () => Promise.resolve(["cal1"]),
      listPushChannels: () => Promise.resolve([]),
      redis: { set: () => Promise.resolve("OK") },
    },
    grantedDeadlineMs: (stepName: string): number | null => {
      const reason = signals.get(stepName)?.reason;

      if (!(reason instanceof Error) || !reason.message.includes(stepName)) {
        return null;
      }

      const matched = /exceeded its (\d+)ms deadline/.exec(reason.message);

      if (matched === null) {
        return null;
      }

      return Number(matched[1]);
    },
  };
};

describe("delete user teardown budget against the auth deadline", () => {
  it("finishes inside the auth-side deadline that supervises it when every step hangs", async () => {
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const teardown = createDeleteUserSyncTeardown(hangingRun().dependencies as never);

    const startedAt = Date.now();
    await teardown("user-a");
    const elapsedMs = Date.now() - startedAt;

    expect({
      authDeadlineMs: SYNC_TEARDOWN_TIMEOUT_MS,
      fitsInsideAuthDeadline: elapsedMs < SYNC_TEARDOWN_TIMEOUT_MS,
    }).toEqual({
      authDeadlineMs: expect.any(Number),
      fitsInsideAuthDeadline: true,
    });
  });

  it("gives push_channels the deadline the constants advertise, not the leftover remainder", async () => {
    const teardownModule = await import("@/utils/delete-user-teardown");
    const run = hangingRun();
    const teardown = teardownModule.createDeleteUserSyncTeardown(run.dependencies as never);

    await teardown("user-a");

    expect({
      aborted: run.abortedStep("push_channels"),
      advertisedBudgetMs: teardownModule.PUSH_CHANNELS_TIMEOUT_MS,
      grantedMs: run.grantedDeadlineMs("push_channels"),
    }).toEqual({
      aborted: true,
      advertisedBudgetMs: expect.any(Number),
      grantedMs: teardownModule.PUSH_CHANNELS_TIMEOUT_MS,
    });
  });
});
