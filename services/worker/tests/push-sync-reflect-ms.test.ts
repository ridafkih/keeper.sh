import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { values: {} };

const SYNC_DURATION_MS = 900;

const clock = vi.hoisted(() => ({ ms: 0 }));

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
  // The destination write is where the user-visible lag actually ends, so the clock moves here.
  syncDestinationsForUser: () => {
    clock.ms += SYNC_DURATION_MS;
    return Promise.resolve({
      added: 0,
      addFailed: 0,
      errors: [],
      removed: 0,
      removeFailed: 0,
      syncEvents: [],
    });
  },
}));

const { processJob } = await import("../src/processor");

const WEBHOOK_RECEIVED_AT = 1_700_000_000_000;
const ENQUEUED_AT = WEBHOOK_RECEIVED_AT + 250;
const STARTED_AT = ENQUEUED_AT + 1000;

const runJob = async (job: Record<string, unknown>): Promise<WideEvent> => {
  await (processJob as unknown as (value: unknown) => Promise<unknown>)(job);
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

const createJob = (data: Record<string, unknown>) => ({
  data: {
    calendarId: "calendar-1",
    correlationId: "correlation-1",
    plan: "pro",
    userId: "user-1",
    ...data,
  },
  id: "job-1",
  name: "push-sync",
  processedOn: STARTED_AT,
  timestamp: ENQUEUED_AT,
  updateProgress: () => null,
});

beforeEach(() => {
  emitted.length = 0;
  current = { values: {} };
  clock.ms = STARTED_AT;
  vi.spyOn(Date, "now").mockImplementation(() => clock.ms);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a push sync reports how long since its webhook", () => {
  it("measures from webhook receipt to the end of the destination sync", async () => {
    const event = await runJob(createJob({
      trigger: "push",
      webhookReceivedAt: WEBHOOK_RECEIVED_AT,
    }));

    expect(event.values["push_sync.reflect_ms"]).toBe(
      STARTED_AT + SYNC_DURATION_MS - WEBHOOK_RECEIVED_AT,
    );
  });

  it("does not merely restate the queue wait", async () => {
    const event = await runJob(createJob({
      trigger: "push",
      webhookReceivedAt: WEBHOOK_RECEIVED_AT,
    }));

    expect(event.values["push_sync.reflect_ms"]).toBeGreaterThan(
      Number(event.values["push_sync.queue_wait_ms"]),
    );
  });

  it("omits the field entirely for a cron sync that had no webhook", async () => {
    const event = await runJob(createJob({}));

    expect(event.values["push_sync.trigger"]).toBe("cron");
    expect(Object.hasOwn(event.values, "push_sync.reflect_ms")).toBe(false);
  });
});
