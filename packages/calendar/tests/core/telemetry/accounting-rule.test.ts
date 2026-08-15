import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import {
  measureSegment,
  recordRedisCommandDuration,
  recordSegment,
  type IngestSegmentKey,
} from "../../../src/core/telemetry/segments";

type EmittedEvent = Record<string, unknown>;

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const SEGMENTS: [IngestSegmentKey, number][] = [
  ["wait.source_lock_ms", 12.5],
  ["wait.token_refresh_ms", 3],
  ["wait.rate_limiter_ms", 40.25],
  ["wait.provider_retry_ms", 8],
  ["wait.db_pool_ms", 5],
  ["wait.advisory_lock_ms", 17],
  ["work.provider_http_ms", 22],
  ["work.transform_ms", 1.5],
  ["work.db_read_ms", 9],
  ["work.db_write_ms", 6],
  ["work.db_commit_ms", 4],
  ["work.diff_ms", 2],
];

const MEASURED_SLEEP_MS = 30;

const readNested = (event: EmittedEvent, key: string): number => {
  let node: unknown = event;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== "number") {
    throw new TypeError(`expected ${key} to be a number`);
  }
  return node;
};

const runEvent = async (run: () => Promise<void>): Promise<EmittedEvent> => {
  await context(async () => {
    await run();
    widelog.flush();
  });
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

describe("segment accounting", () => {
  it("makes accounted_ms the exact sum of the twelve segments", async () => {
    const event = await runEvent(async () => {
      for (const [key, durationMs] of SEGMENTS) {
        recordSegment(key, durationMs);
      }
      await Promise.resolve();
    });

    let total = 0;
    for (const [, durationMs] of SEGMENTS) {
      total += durationMs;
    }
    expect(readNested(event, "accounted_ms")).toBeCloseTo(total, 2);
    for (const [key, durationMs] of SEGMENTS) {
      expect(readNested(event, key)).toBeCloseTo(durationMs, 2);
    }
  });

  it("accumulates repeat recordings of one key rather than replacing them", async () => {
    const event = await runEvent(async () => {
      recordSegment("work.db_read_ms", 10);
      recordSegment("work.db_read_ms", 15);
      await Promise.resolve();
    });

    expect(readNested(event, "work.db_read_ms")).toBeCloseTo(25, 2);
    expect(readNested(event, "accounted_ms")).toBeCloseTo(25, 2);
  });

  it("keeps the redis overlay out of the accounted sum", async () => {
    const event = await runEvent(async () => {
      recordSegment("wait.source_lock_ms", 50);
      recordRedisCommandDuration(30);
      recordRedisCommandDuration(10);
      await Promise.resolve();
    });

    expect(readNested(event, "redis.command_ms_max")).toBeCloseTo(30, 2);
    expect(readNested(event, "accounted_ms")).toBeCloseTo(50, 2);
  });

  it("still records the segment when the measured operation throws", async () => {
    const event = await runEvent(async () => {
      await measureSegment("work.provider_http_ms", async () => {
        await Bun.sleep(MEASURED_SLEEP_MS);
        throw new Error("provider exploded");
      }).catch(() => null);
    });

    expect(readNested(event, "work.provider_http_ms")).toBeGreaterThanOrEqual(MEASURED_SLEEP_MS);
    expect(readNested(event, "accounted_ms"))
      .toBeCloseTo(readNested(event, "work.provider_http_ms"), 2);
  });

  it("leaves the residual computable as duration_ms minus accounted_ms", async () => {
    const event = await runEvent(() => widelog.time.measure("duration_ms", async () => {
      await measureSegment("wait.rate_limiter_ms", () => Bun.sleep(MEASURED_SLEEP_MS));
      await Bun.sleep(MEASURED_SLEEP_MS);
    }));

    const residual = readNested(event, "duration_ms") - readNested(event, "accounted_ms");
    expect(residual).toBeGreaterThanOrEqual(MEASURED_SLEEP_MS * 0.5);
    expect(readNested(event, "accounted_ms"))
      .toBeLessThanOrEqual(readNested(event, "duration_ms"));
  });
});
