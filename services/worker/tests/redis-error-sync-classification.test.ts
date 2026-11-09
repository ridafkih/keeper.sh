import { MaxRetriesPerRequestError } from "ioredis/built/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { fields: {}, values: {} };
let calendarFailure:
  | ((handlers: { onCalendarError: (failure: Record<string, unknown>) => void }) => void)
  | null = null;
let syncOutcome: () => unknown = () => ({
  added: 0,
  addFailed: 0,
  errors: [],
  removed: 0,
  removeFailed: 0,
  syncEvents: [],
});

vi.mock("../src/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  destroy: () => null,
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    errors: () => null,
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
      return { sticky: () => null };
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("../src/env", () => ({
  default: {
    ENCRYPTION_KEY: "0".repeat(64),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client",
    MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  },
}));

vi.mock("../src/context", () => ({
  database: {},
  refreshLockRedis: {},
  refreshLockStore: {},
  shutdownConnections: () => null,
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createBroadcastService: () => ({ emit: () => null }),
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncAggregateRuntime: () => ({
    onDestinationSync: () => Promise.resolve(),
    onSyncProgress: () => null,
  }),
  SyncLockRenewalError: class SyncLockRenewalError extends Error {},
  syncDestinationsForUser: (
    _userId: string,
    _options: unknown,
    handlers: { onCalendarError: (failure: Record<string, unknown>) => void },
  ) => {
    calendarFailure?.(handlers);
    return Promise.resolve(syncOutcome());
  },
}));

const { processJob } = await import("../src/processor");

const createJob = () => ({
  data: {
    calendarId: "calendar-1",
    correlationId: "correlation-1",
    plan: "pro",
    userId: "user-1",
  },
  id: "job-1",
  name: "push-sync",
  updateProgress: () => null,
});

const runProcessJob = (): Promise<unknown> =>
  (processJob as unknown as (job: unknown) => Promise<unknown>)(createJob());

const runFailingJob = async (error: Error): Promise<WideEvent> => {
  syncOutcome = () => {
    throw error;
  };
  await expect(
    runProcessJob(),
  ).rejects.toThrow();
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

describe("worker sync-error classification for Redis failures", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
    calendarFailure = null;
  });

  it("labels a sync that lost Redis as Redis being unavailable", async () => {
    const event = await runFailingJob(new MaxRetriesPerRequestError(3));

    expect(event.fields.slug).toBe("redis-unavailable");
  });
});
