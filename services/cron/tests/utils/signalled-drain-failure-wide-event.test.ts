import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: { select: () => ({}), update: () => ({}) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/jobs/drain-pending-ingest", () => ({
  createDefaultDependencies: () => Promise.resolve({}),
}));
vi.mock("../../src/utils/drain-pending-ingest", () => ({
  runDrainPendingIngest: () => Promise.reject(new Error("drain exploded")),
}));

const { SIGNAL_DRAIN_FAILED_SLUG, drainSignalledCalendars } = await import(
  "../../src/utils/start-pending-signal-reader"
);

interface EmittedEvent {
  error?: { error_message?: string; retriable?: boolean; slug?: string };
  operation?: { name?: string };
  outcome?: string;
  push_drain?: { signalled_count?: number };
}

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

const captureLine = (chunk: unknown): void => {
  const text = String(chunk);
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    emitted.push(JSON.parse(line) as EmittedEvent);
  }
};

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    captureLine(chunk);
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const scoreRedis = {
  del: (...keys: string[]) => Promise.resolve(keys.length),
  hmget: () => Promise.resolve([]),
  hsetnx: () => Promise.resolve(0),
  set: () => Promise.resolve("OK"),
  zscore: () => Promise.resolve(null),
};

describe("a failed signalled drain still emits and still does not throw", () => {
  it("emits the failure event and resolves so the reader loop survives", async () => {
    const settled = await drainSignalledCalendars(scoreRedis, ["calendar-a", "calendar-b"]).then(
      () => "resolved",
      () => "rejected",
    );

    expect(settled).toBe("resolved");

    const drainEvents = emitted.filter(
      (event) => event.operation?.name === "drain-signalled-calendars",
    );
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0]?.outcome).toBe("error");
    expect(drainEvents[0]?.error?.slug).toBe(SIGNAL_DRAIN_FAILED_SLUG);
    expect(drainEvents[0]?.error?.retriable).toBe(true);
    expect(drainEvents[0]?.push_drain?.signalled_count).toBe(2);
  });
});
