import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";

const recordedRequests = vi.hoisted((): { userId: unknown }[] => []);
const scenario = vi.hoisted(() => ({ checkpointed: 0, deadlineFires: true }));

vi.mock("../src/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  destroy: () => null,
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    errors: () => null,
    flush: () => null,
    set: () => ({ sticky: () => null }),
    setFields: () => ({ sticky: () => null }),
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
  database: {
    insert: () => ({
      values: (row: { userId: unknown }) => ({
        onConflictDoUpdate: () => {
          recordedRequests.push({ userId: row.userId });
          return Promise.resolve();
        },
      }),
    }),
  },
  refreshLockRedis: {},
  refreshLockStore: {},
  shutdownConnections: () => null,
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createBroadcastService: () => ({ emit: () => null }),
}));

interface ProgressHandlers {
  onProgress: (update: Record<string, unknown>) => void;
}

vi.mock("@keeper.sh/sync", () => ({
  SyncLockRenewalError: class SyncLockRenewalError extends Error {},
  recordFirstSyncedMappings: () => Promise.resolve([]),
  syncDestinationsForUser: (_userId: string, _options: unknown, handlers: ProgressHandlers) => {
    if (scenario.checkpointed > 0) {
      handlers.onProgress({
        calendarId: "calendar-1",
        progress: { current: scenario.checkpointed, total: 1200 },
        stage: "processing",
        status: "syncing",
        userId: "user-1",
      });
    }
    if (scenario.deadlineFires) {
      vi.advanceTimersByTime(USER_TIMEOUT_MS + 1);
    }
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

const runJob = (): Promise<{ continuationRequested?: boolean }> =>
  (processJob as unknown as (job: unknown) => Promise<{ continuationRequested?: boolean }>)({
    data: { calendarId: "calendar-1", correlationId: "correlation-1", plan: "free", userId: "user-1" },
    id: "job-1",
    name: "push-sync",
    processedOn: 0,
    timestamp: 0,
    updateProgress: () => null,
  });

beforeEach(() => {
  recordedRequests.length = 0;
  scenario.checkpointed = 0;
  scenario.deadlineFires = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a push sync cut short by its deadline", () => {
  it("records a durable sync request and asks to continue when it checkpointed work", async () => {
    scenario.checkpointed = 250;

    const result = await runJob();

    expect(recordedRequests).toEqual([{ userId: "user-1" }]);
    expect(result.continuationRequested).toBe(true);
  });

  it("leaves the next run to the schedule when nothing was checkpointed", async () => {
    const result = await runJob();

    expect(recordedRequests).toEqual([]);
    expect(result.continuationRequested).toBe(false);
  });

  it("does not continue a run that finished inside its deadline", async () => {
    scenario.checkpointed = 250;
    scenario.deadlineFires = false;

    const result = await runJob();

    expect(recordedRequests).toEqual([]);
    expect(result.continuationRequested).toBe(false);
  });
});
