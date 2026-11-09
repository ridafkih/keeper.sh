import {
  GOOGLE_PROJECT_REQUESTS_PER_MINUTE,
  GOOGLE_REQUESTS_PER_MINUTE,
} from "@keeper.sh/constants";
import { describe, expect, it, vi } from "vitest";
import {
  GoogleProjectBudgetExhaustedError,
  createGoogleInteractiveRateLimiter,
  createGoogleUserRateLimiter,
  createRedisRateLimiter,
  resolveGoogleProjectRequestsPerMinute,
  withGoogleProjectBudget,
} from "../../../src/core/utils/redis-rate-limiter";

describe("createRedisRateLimiter", () => {
  it("returns immediately when Redis grants capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", {
      requestsPerMinute: 10,
    });

    await expect(limiter.acquire(1)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("aborts while waiting for capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([60_000, 10])) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", {
      requestsPerMinute: 10,
    });
    const controller = new AbortController();
    const result = limiter.acquire(1, controller.signal);

    controller.abort(new Error("source deadline exceeded"));

    await expect(result).rejects.toThrow("source deadline exceeded");
    expect(redis.eval).toHaveBeenCalledOnce();
  });
});

describe("createGoogleUserRateLimiter", () => {
  const acquireArguments = async (lane: "ingest" | "push"): Promise<string[]> => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    await createGoogleUserRateLimiter(redis, "user-id", lane).acquire(1);
    return vi.mocked(redis.eval).mock.calls[0]?.slice(2) as string[];
  };

  it("meters both lanes against one key so the per-user quota is never doubled", async () => {
    const [ingestKey] = await acquireArguments("ingest");
    const [pushKey] = await acquireArguments("push");

    expect(ingestKey).toBe("ratelimit:user-id:google");
    expect(pushKey).toBe(ingestKey);
  });

  it("caps destination push below the quota so ingestion keeps reserved headroom", async () => {
    const ingestArguments = await acquireArguments("ingest");
    const pushArguments = await acquireArguments("push");
    const ingestLimit = Number(ingestArguments.at(-1));
    const pushLimit = Number(pushArguments.at(-1));

    expect(ingestLimit).toBe(GOOGLE_REQUESTS_PER_MINUTE);
    expect(pushLimit).toBeLessThan(GOOGLE_REQUESTS_PER_MINUTE);
  });
});

describe("withGoogleProjectBudget", () => {
  const grantingRedis = () => ({ eval: vi.fn(() => Promise.resolve([0, 0])) });

  const evaluatedKeys = (redis: ReturnType<typeof grantingRedis>): string[] =>
    vi.mocked(redis.eval).mock.calls.map((call) => String(call.at(2)));

  const evaluatedLimit = (redis: ReturnType<typeof grantingRedis>, key: string): number =>
    Number(vi.mocked(redis.eval).mock.calls.find((call) => call.at(2) === key)?.at(6));

  it("meters every user and lane against one project key", async () => {
    const redis = grantingRedis();

    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "ingest"),
    ).acquire(1);
    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-b", "push"),
    ).acquire(1);

    expect(evaluatedKeys(redis)).toEqual([
      "ratelimit:user-a:google",
      "ratelimit:google:project",
      "ratelimit:user-b:google",
      "ratelimit:google:project",
    ]);
  });

  it("spends a batch's full request count from the project budget", async () => {
    const redis = grantingRedis();

    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "push"),
    ).acquire(50);

    const projectCall = vi.mocked(redis.eval).mock.calls.find(
      (call) => call.at(2) === "ratelimit:google:project",
    );
    expect(projectCall?.at(5)).toBe("50");
  });

  it("leaves background work 90% of Google's published per-minute limit by default", async () => {
    const redis = grantingRedis();

    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "ingest"),
    ).acquire(1);

    expect(evaluatedLimit(redis, "ratelimit:google:project")).toBe(
      GOOGLE_PROJECT_REQUESTS_PER_MINUTE * 0.9,
    );
  });

  it("leaves background work 90% of a configured project limit", async () => {
    const redis = grantingRedis();

    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "ingest"),
      2500,
    ).acquire(1);

    expect(evaluatedLimit(redis, "ratelimit:google:project")).toBe(2250);
  });

  it("leaves only the per-user limit when the project limit is set to zero", async () => {
    const redis = grantingRedis();

    await withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "ingest"),
      0,
    ).acquire(1);

    expect(evaluatedKeys(redis)).toEqual(["ratelimit:user-a:google"]);
  });

  it("waits on the user before spending the project's budget", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([60_000, 500])) };
    const controller = new AbortController();
    const result = withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-a", "ingest"),
    ).acquire(1, controller.signal);

    controller.abort(new Error("source deadline exceeded"));

    await expect(result).rejects.toThrow("source deadline exceeded");
    expect(vi.mocked(redis.eval).mock.calls.map((call) => call.at(2))).not.toContain(
      "ratelimit:google:project",
    );
  });
});

describe("createGoogleInteractiveRateLimiter", () => {
  const grantingRedis = () => ({ eval: vi.fn(() => Promise.resolve([0, 0])) });

  it("spends from the same project window at the full project limit", async () => {
    const redis = grantingRedis();

    await createGoogleInteractiveRateLimiter(redis)?.acquire(1);

    const [call] = vi.mocked(redis.eval).mock.calls;
    expect(call?.at(2)).toBe("ratelimit:google:project");
    expect(Number(call?.at(6))).toBe(GOOGLE_PROJECT_REQUESTS_PER_MINUTE);
  });

  it("never joins the queue background waiters park in", async () => {
    let calls = 0;
    const redis = {
      eval: vi.fn((script: string) => {
        calls += 1;
        expect(script).not.toContain(":queue");
        if (calls < 3) {
          return Promise.resolve([100, 10_000]);
        }
        return Promise.resolve([0, 9999]);
      }),
    };

    await createGoogleInteractiveRateLimiter(redis)?.acquire(1);

    expect(redis.eval).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(redis.eval).mock.calls) {
      expect(call).toHaveLength(7);
    }
  });

  it("gives up with a quota error once its wait runs out", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([60_000, 10_000])) };
    const limiter = createGoogleInteractiveRateLimiter(redis, GOOGLE_PROJECT_REQUESTS_PER_MINUTE, {
      maxWaitMs: 50,
    });

    await expect(limiter?.acquire(1)).rejects.toBeInstanceOf(GoogleProjectBudgetExhaustedError);
  });

  it("passes on the caller's own abort instead of reporting quota", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([60_000, 10_000])) };
    const controller = new AbortController();
    const result = createGoogleInteractiveRateLimiter(redis)?.acquire(1, controller.signal);

    controller.abort(new Error("request closed"));

    await expect(result).rejects.toThrow("request closed");
  });

  it("is absent when the project limit is lifted", () => {
    expect(createGoogleInteractiveRateLimiter(grantingRedis(), 0)).toBeNull();
  });
});

describe("resolveGoogleProjectRequestsPerMinute", () => {
  it("defaults to Google's published per-project limit when nothing is configured", () => {
    expect(resolveGoogleProjectRequestsPerMinute()).toBe(GOOGLE_PROJECT_REQUESTS_PER_MINUTE);
  });

  it.each([
    [2500, 2500],
    [0, null],
    [-1, GOOGLE_PROJECT_REQUESTS_PER_MINUTE],
    [Number.NaN, GOOGLE_PROJECT_REQUESTS_PER_MINUTE],
  ])("resolves %s to %s", (configured, expected) => {
    expect(resolveGoogleProjectRequestsPerMinute(configured)).toBe(expected);
  });
});
