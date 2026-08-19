import { describe, expect, it } from "vitest";
import {
  CALDAV_MAX_THROTTLE_RETRIES,
  fetchHonouringRetryAfter,
  resolveThrottleDelayMs,
} from "../../../src/providers/caldav/shared/throttle-retry";

const throttled = (retryAfter: string | null): Response => {
  const headers = new Headers();
  if (retryAfter !== null) {
    headers.set("Retry-After", retryAfter);
  }
  return new Response(null, { headers, status: 503 });
};

const collectDelays = async (
  responses: Response[],
): Promise<{ delays: number[]; sends: number }> => {
  const delays: number[] = [];
  const queue = [...responses];
  let sends = 0;
  await fetchHonouringRetryAfter(
    () => {
      sends++;
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
  return { delays, sends };
};

describe("CalDAV throttle retry", () => {
  it("retries a 503 instead of surfacing it as a failure", async () => {
    const { sends } = await collectDelays([throttled("1")]);

    expect(sends).toBe(2);
  });

  it("waits longer than Apple asks, because its interval re-trips the throttle", async () => {
    const { delays } = await collectDelays([throttled("1")]);

    expect(delays[0]).toBeGreaterThan(1000);
  });

  it("obeys a Retry-After that is longer than the floor", async () => {
    const { delays } = await collectDelays([throttled("30")]);

    expect(delays[0]).toBe(30_000);
  });

  it("backs off further on each successive throttle", async () => {
    const { delays } = await collectDelays([throttled(null), throttled(null)]);

    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
  });

  it("gives up rather than retrying a throttled server forever", async () => {
    const { sends } = await collectDelays(
      Array.from({ length: 10 }, () => throttled("1")),
    );

    expect(sends).toBe(CALDAV_MAX_THROTTLE_RETRIES + 1);
  });

  it("never sleeps past the cap, however far away the header points", () => {
    expect(resolveThrottleDelayMs(999_999_999, 0)).toBeLessThanOrEqual(64_000);
  });

  it("returns a successful response without waiting at all", async () => {
    const { delays, sends } = await collectDelays([]);

    expect(delays).toHaveLength(0);
    expect(sends).toBe(1);
  });
});
