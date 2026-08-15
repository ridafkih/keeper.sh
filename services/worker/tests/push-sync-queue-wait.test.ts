import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { values: {} };

vi.mock("../src/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  destroy: () => null,
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    errors: () => null,
    flush: () => {
      emitted.push(current);
      current = { values: {} };
    },
    max: () => null,
    min: () => null,
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
  syncDestinationsForUser: () => Promise.resolve({
    added: 0,
    addFailed: 0,
    errors: [],
    removed: 0,
    removeFailed: 0,
    syncEvents: [],
  }),
}));

const { processJob } = await import("../src/processor");

const QUEUE_WAIT_MS = 4200;
const ENQUEUED_AT = 1_700_000_000_000;

const runJob = async (job: Record<string, unknown>): Promise<WideEvent> => {
  await (processJob as unknown as (value: unknown) => Promise<unknown>)(job);
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

const createJob = (
  { data, processedOn }: { data?: Record<string, unknown>; processedOn: number },
) => ({
  data: {
    calendarId: "calendar-1",
    correlationId: "correlation-1",
    plan: "pro",
    userId: "user-1",
    ...data,
  },
  id: "job-1",
  name: "push-sync",
  processedOn,
  timestamp: ENQUEUED_AT,
  updateProgress: () => null,
});

beforeEach(() => {
  emitted.length = 0;
  current = { values: {} };
});

describe("push sync queue wait", () => {
  it("reports how long the job sat in the waiting list", async () => {
    const event = await runJob(createJob({
      data: { trigger: "push" },
      processedOn: ENQUEUED_AT + QUEUE_WAIT_MS,
    }));

    expect(event.values["push_sync.queue_wait_ms"]).toBe(QUEUE_WAIT_MS);
    expect(event.values["push_sync.trigger"]).toBe("push");
  });

  it("falls back to cron for a payload enqueued before the field existed", async () => {
    const event = await runJob(createJob({ processedOn: ENQUEUED_AT }));

    expect(event.values["push_sync.trigger"]).toBe("cron");
    expect(event.values["push_sync.queue_wait_ms"]).toBe(0);
  });
});
