import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import {
  CALDAV_MAX_THROTTLE_RETRIES,
  fetchHonouringRetryAfter,
} from "../../../src/providers/caldav/shared/throttle-retry";

interface EmittedEvent {
  accounted_ms?: number;
  ratelimit?: {
    provider_throttle_count?: number;
    retry_after_honoured_count?: number;
    throttle_floor_count?: number;
    throttle_wait_ms?: number;
  };
  source?: string;
  wait?: { provider_retry_ms?: number };
}

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

const FLOOR_MS = 2000;
const SECOND_FLOOR_MS = 4000;
const THIRD_FLOOR_MS = 8000;
const LONG_RETRY_AFTER_SECONDS = "30";
const LONG_RETRY_AFTER_MS = 30_000;
const THROTTLED_STATUS = 503;
const RATE_LIMITED_STATUS = 429;

const throttled = (status: number, retryAfter: string | null): Response => {
  const headers = new Headers();
  if (retryAfter !== null) {
    headers.set("Retry-After", retryAfter);
  }
  return new Response(null, { headers, status });
};

interface DriveResult {
  delays: number[];
  event: EmittedEvent;
  sends: number;
}

const drive = async (source: string, responses: Response[]): Promise<DriveResult> => {
  const delays: number[] = [];
  const queue = [...responses];
  let sends = 0;
  await context(async () => {
    widelog.set("source", source);
    await fetchHonouringRetryAfter(
      () => {
        sends += 1;
        return Promise.resolve(queue.shift() ?? new Response(null, { status: 200 }));
      },
      "https://caldav.icloud.com/",
      {
        sleep: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      },
    );
    widelog.flush();
  });
  const event = emitted.find((candidate) => candidate.source === source);
  if (!event) {
    throw new Error(`no wide event was emitted for ${source}`);
  }
  return { delays, event, sends };
};

describe("a CalDAV throttle is recorded", () => {
  it("records the throttle, the wait and the floor as its source when no Retry-After is offered", async () => {
    const { delays, event, sends } = await drive("floor-throttle", [
      throttled(THROTTLED_STATUS, null),
    ]);

    expect(sends).toBe(2);
    expect(delays).toEqual([FLOOR_MS]);
    expect(event.ratelimit?.provider_throttle_count).toBe(1);
    expect(event.ratelimit?.throttle_wait_ms).toBe(FLOOR_MS);
    expect(event.ratelimit?.throttle_floor_count).toBe(1);
    expect(event.ratelimit?.retry_after_honoured_count).toBeUndefined();
  });

  it("records a provider-supplied Retry-After as the source of the wait", async () => {
    const { delays, event, sends } = await drive("header-throttle", [
      throttled(RATE_LIMITED_STATUS, LONG_RETRY_AFTER_SECONDS),
    ]);

    expect(sends).toBe(2);
    expect(delays).toEqual([LONG_RETRY_AFTER_MS]);
    expect(event.ratelimit?.provider_throttle_count).toBe(1);
    expect(event.ratelimit?.throttle_wait_ms).toBe(LONG_RETRY_AFTER_MS);
    expect(event.ratelimit?.retry_after_honoured_count).toBe(1);
    expect(event.ratelimit?.throttle_floor_count).toBeUndefined();
  });

  it("credits a Retry-After shorter than the floor to the floor that overrode it", async () => {
    const { delays, event } = await drive("short-header-throttle", [
      throttled(THROTTLED_STATUS, "1"),
    ]);

    expect(delays).toEqual([FLOOR_MS]);
    expect(event.ratelimit?.throttle_wait_ms).toBe(FLOOR_MS);
    expect(event.ratelimit?.throttle_floor_count).toBe(1);
    expect(event.ratelimit?.retry_after_honoured_count).toBeUndefined();
  });

  it("sums every wait across a doubling backoff without changing the attempt count", async () => {
    const { delays, event, sends } = await drive(
      "exhausted-throttle",
      Array.from({ length: 10 }, () => throttled(THROTTLED_STATUS, null)),
    );

    expect(sends).toBe(CALDAV_MAX_THROTTLE_RETRIES + 1);
    expect(delays).toEqual([FLOOR_MS, SECOND_FLOOR_MS, THIRD_FLOOR_MS]);
    expect(event.ratelimit?.provider_throttle_count).toBe(CALDAV_MAX_THROTTLE_RETRIES);
    expect(event.ratelimit?.throttle_wait_ms).toBe(FLOOR_MS + SECOND_FLOOR_MS + THIRD_FLOOR_MS);
    expect(event.ratelimit?.throttle_floor_count).toBe(CALDAV_MAX_THROTTLE_RETRIES);
  });

  it("accounts the time parked on a throttle as provider retry wait", async () => {
    const { event } = await drive("accounted-throttle", [throttled(THROTTLED_STATUS, null)]);

    expect(event.wait?.provider_retry_ms).toBeGreaterThanOrEqual(0);
    expect(event.accounted_ms).toBe(event.wait?.provider_retry_ms);
  });

  it("records nothing at all when the request was never throttled", async () => {
    const { delays, event, sends } = await drive("clean-request", []);

    expect(sends).toBe(1);
    expect(delays).toHaveLength(0);
    expect(event.ratelimit?.provider_throttle_count).toBeUndefined();
    expect(event.ratelimit?.throttle_wait_ms).toBeUndefined();
    expect(event.ratelimit?.throttle_floor_count).toBeUndefined();
    expect(event.ratelimit?.retry_after_honoured_count).toBeUndefined();
  });
});
