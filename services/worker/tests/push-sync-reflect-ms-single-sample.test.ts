import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";

interface WideEvent {
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { values: {} };

const SYNC_DURATION_MS = 900;
const DEADLINE_OVERRUN_MS = 5000;

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

interface CalendarCompletion {
  accountId: string;
  added: number;
  addFailed: number;
  calendarId: string;
  conflictsResolved: number;
  durationMs: number;
  errors: unknown[];
  provider: string;
  removed: number;
  removeFailed: number;
  syncEvent: { outcome: string };
}

interface SyncHandlers {
  onCalendarComplete: (completion: CalendarCompletion) => void;
}

vi.mock("@keeper.sh/sync", () => ({
  createSyncAggregateRuntime: () => ({
    onDestinationSync: () => Promise.resolve(),
    onSyncProgress: () => null,
  }),
  SyncLockRenewalError: class SyncLockRenewalError extends Error {},
  syncDestinationsForUser: (
    _userId: string,
    _options: unknown,
    handlers: SyncHandlers,
  ) => {
    clock.ms += SYNC_DURATION_MS;
    handlers.onCalendarComplete({
      accountId: "account-1",
      added: 1,
      addFailed: 0,
      calendarId: "calendar-1",
      conflictsResolved: 0,
      durationMs: SYNC_DURATION_MS,
      errors: [],
      provider: "google",
      removed: 0,
      removeFailed: 0,
      syncEvent: { outcome: "success" },
    });

    clock.ms += DEADLINE_OVERRUN_MS;
    vi.advanceTimersByTime(USER_TIMEOUT_MS + 1);

    return Promise.resolve({
      added: 1,
      addFailed: 0,
      errors: [],
      removed: 0,
      removeFailed: 0,
      syncEvents: [{ "calendar.id": "calendar-1", outcome: "success" }],
    });
  },
}));

const { processJob } = await import("../src/processor");

const WEBHOOK_RECEIVED_AT = 1_700_000_000_000;
const ENQUEUED_AT = WEBHOOK_RECEIVED_AT + 250;
const STARTED_AT = ENQUEUED_AT + 1000;

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

const runJob = async (job: Record<string, unknown>): Promise<WideEvent[]> => {
  await (processJob as unknown as (value: unknown) => Promise<unknown>)(job);
  if (emitted.length === 0) {
    throw new Error("no wide event was emitted");
  }
  return emitted;
};

const reflectSamples = (events: WideEvent[]): unknown[] =>
  events
    .filter((event) => Object.hasOwn(event.values, "push_sync.reflect_ms"))
    .map((event) => event.values["push_sync.reflect_ms"]);

beforeEach(() => {
  emitted.length = 0;
  current = { values: {} };
  clock.ms = STARTED_AT;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => clock.ms);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("one webhook produces one sample", () => {
  it("records reflect_ms once when the deadline fires after the calendar already flushed", async () => {
    const events = await runJob(createJob({
      trigger: "push",
      webhookReceivedAt: WEBHOOK_RECEIVED_AT,
    }));

    expect(events.length).toBeGreaterThan(1);
    expect(reflectSamples(events)).toEqual([
      STARTED_AT + SYNC_DURATION_MS - WEBHOOK_RECEIVED_AT,
    ]);
  });

  it("does not emit a second, later sample from the deadline flush", async () => {
    const events = await runJob(createJob({
      trigger: "push",
      webhookReceivedAt: WEBHOOK_RECEIVED_AT,
    }));

    const deadlineEvents = events.filter(
      (event) => event.values["timeout.kind"] === "job_deadline",
    );

    expect(deadlineEvents.length).toBe(1);
    expect(
      deadlineEvents.every(
        (event) => !Object.hasOwn(event.values, "push_sync.reflect_ms"),
      ),
    ).toBe(true);
  });

  it("leaves the field absent, never zero, on a cron job that hits the deadline", async () => {
    const events = await runJob(createJob({}));

    expect(events[0]?.values["push_sync.trigger"]).toBe("cron");
    expect(reflectSamples(events)).toEqual([]);
    for (const event of events) {
      expect(Object.hasOwn(event.values, "push_sync.reflect_ms")).toBe(false);
    }
  });
});
