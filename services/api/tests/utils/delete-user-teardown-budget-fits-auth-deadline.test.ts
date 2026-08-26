import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_TEARDOWN_TIMEOUT_MS } from "@keeper.sh/auth";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

const loggedErrors: LoggedError[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: (prefix: string, error: unknown) => {
      loggedErrors.push({ error, fields: { prefix } });
    },
    errorFields: (error: unknown, fields: Record<string, unknown>) => {
      loggedErrors.push({ error, fields });
    },
    set: (key: string, value: unknown) => {
      loggedErrors.push({ error: null, fields: { [key]: value } });
    },
    setFields: (fields: Record<string, unknown>) => {
      loggedErrors.push({ error: null, fields });
    },
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

const stepSignals = new Map<string, AbortSignal>();
const hangingResolvers: ((value: never) => void)[] = [];

const hang = (stepName: string, signal?: AbortSignal): Promise<never> => {
  if (signal) {
    stepSignals.set(stepName, signal);
  }

  return new Promise<never>((resolve) => {
    hangingResolvers.push(resolve);
  });
};

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  markUserDeleted: (
    _redis: unknown,
    _userId: string,
    options: { signal?: AbortSignal },
  ) => hang("tombstone", options.signal),
}));

vi.mock("@keeper.sh/queue", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPushSyncQueue: () => ({
    getJob: () => Promise.resolve(),
    remove: () => Promise.resolve(0),
  }),
  removeUserSyncJobs: () => hang("sync_jobs"),
}));

const deadlineMessages = (): string[] =>
  loggedErrors
    .filter((entry) => entry.error instanceof Error)
    .map((entry) => (entry.error as Error).message)
    .filter((message) => message.includes("exceeded its"));

const grantedDeadlineMs = (stepName: string): number | null => {
  const message = deadlineMessages().find((candidate) => candidate.includes(stepName));

  if (!message) {
    return null;
  }

  const matched = /exceeded its (\d+)ms deadline/.exec(message);

  if (matched === null) {
    return null;
  }

  return Number(matched[1]);
};

const abortedStep = (stepName: string): boolean => {
  const signal = stepSignals.get(stepName);

  if (!signal) {
    return false;
  }

  return signal.aborted;
};

const hangingDependencies = () => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: (_userId: string, signal: AbortSignal) => hang("push_channels", signal),
  listCalendarIds: () => Promise.resolve(["cal1"]),
  redis: { set: () => Promise.resolve("OK") },
});

beforeEach(() => {
  loggedErrors.length = 0;
  stepSignals.clear();
  hangingResolvers.length = 0;
});

describe("delete user teardown budget against the auth deadline", () => {
  it("finishes inside the auth-side deadline that supervises it when every step hangs", async () => {
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const teardown = createDeleteUserSyncTeardown(hangingDependencies() as never);

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
    const teardown = teardownModule.createDeleteUserSyncTeardown(hangingDependencies() as never);

    await teardown("user-a");

    expect({
      aborted: abortedStep("push_channels"),
      advertisedBudgetMs: teardownModule.PUSH_CHANNELS_TIMEOUT_MS,
      grantedMs: grantedDeadlineMs("push_channels"),
    }).toEqual({
      aborted: true,
      advertisedBudgetMs: expect.any(Number),
      grantedMs: teardownModule.PUSH_CHANNELS_TIMEOUT_MS,
    });
  });
});
