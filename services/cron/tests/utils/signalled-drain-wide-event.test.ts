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
  runDrainPendingIngest: () => Promise.resolve(),
}));

const { drainSignalledCalendars } = await import("../../src/utils/start-pending-signal-reader");

interface EmittedEvent {
  duration_ms?: number;
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

describe("a signalled drain emits its wide event", () => {
  it("hands the successful drain's event to the transport", async () => {
    await drainSignalledCalendars(scoreRedis, ["calendar-a", "calendar-b", "calendar-c"]);

    const drainEvents = emitted.filter(
      (event) => event.operation?.name === "drain-signalled-calendars",
    );
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0]?.push_drain?.signalled_count).toBe(3);
    expect(drainEvents[0]?.outcome).toBe("success");
    expect(typeof drainEvents[0]?.duration_ms).toBe("number");
  });
});
