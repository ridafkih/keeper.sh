import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

/*
 * The acquire script now returns {waitTime, occupancy} instead of a bare waitTime.
 * Occupancy is telemetry only: it must never move an allow/deny decision, and the
 * wait time must still come from element one unchanged.
 */
const WINDOW_MS = 60_000;
const SOURCE_PATH = new URL(
  "../../../src/core/utils/redis-rate-limiter.ts",
  import.meta.url,
);

interface WindowState {
  now: number;
  oldestScore: number | null;
  occupancy: number;
}

const legacyWaitTime = (state: WindowState, count: number, limit: number): number => {
  if (state.occupancy + count <= limit) {
    return 0;
  }
  if (state.oldestScore !== null) {
    return state.oldestScore + WINDOW_MS - state.now;
  }
  return 1000;
};

const expectedEvalCount = (waitTime: number): number => {
  if (waitTime <= 0) {
    return 1;
  }
  return 2;
};

const CASES: { count: number; limit: number; state: WindowState }[] = [
  { count: 1, limit: 30, state: { now: 60_000, occupancy: 0, oldestScore: null } },
  { count: 1, limit: 30, state: { now: 60_000, occupancy: 29, oldestScore: 100 } },
  { count: 1, limit: 30, state: { now: 60_000, occupancy: 30, oldestScore: 100 } },
  { count: 5, limit: 30, state: { now: 60_000, occupancy: 26, oldestScore: 150 } },
  { count: 1, limit: 30, state: { now: 60_000, occupancy: 30, oldestScore: null } },
];

interface DecisionTrace {
  evalCount: number;
  parameters: string[];
}

/*
 * The first reply carries the decision under test; every later reply grants so the
 * loop terminates. One eval therefore means "granted outright", two means "throttled".
 */
const traceFirstDecision = async (
  state: WindowState,
  count: number,
  limit: number,
): Promise<DecisionTrace> => {
  const waitTime = legacyWaitTime(state, count, limit);
  const trace: DecisionTrace = { evalCount: 0, parameters: [] };
  const redis = {
    eval: (_script: string, _keys: number, ...parameters: string[]): Promise<unknown> => {
      trace.evalCount += 1;
      if (trace.evalCount === 1) {
        trace.parameters = parameters;
        return Promise.resolve([waitTime, state.occupancy]);
      }
      return Promise.resolve([0, state.occupancy]);
    },
  };
  const limiter = createRedisRateLimiter(redis, "ratelimit:parity:google", {
    requestsPerMinute: limit,
  });
  await limiter.acquire(count);
  return trace;
};

describe("acquire script result contract", () => {
  it("grants or throttles exactly as the legacy scalar would have", async () => {
    for (const { count, limit, state } of CASES) {
      const trace = await traceFirstDecision(state, count, limit);
      expect(trace.evalCount).toBe(expectedEvalCount(legacyWaitTime(state, count, limit)));
    }
  });

  it("passes the same window arguments to redis as before", async () => {
    const [grantingCase] = CASES;
    if (!grantingCase) {
      throw new Error("the case table lost its granting case");
    }
    const { parameters } = await traceFirstDecision(grantingCase.state, 1, 30);
    const [key, windowStart, now, count, limit] = parameters;

    expect(key).toBe("ratelimit:parity:google");
    expect(Number(now) - Number(windowStart)).toBe(WINDOW_MS);
    expect(count).toBe("1");
    expect(limit).toBe("30");
  });

  it("ignores occupancy entirely when deciding", async () => {
    const redis = {
      eval: vi.fn()
        .mockResolvedValueOnce([0, 999])
        .mockResolvedValueOnce([0, 0]),
    };
    const limiter = createRedisRateLimiter(redis, "ratelimit:parity-2:google", {
      requestsPerMinute: 30,
    });

    await expect(limiter.acquire(1)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("fails loudly when the script returns the legacy scalar shape", async () => {
    const limiter = createRedisRateLimiter(
      { eval: () => Promise.resolve(0) },
      "ratelimit:parity-3:google",
      { requestsPerMinute: 30 },
    );

    await expect(limiter.acquire(1)).rejects.toThrow("unexpected result shape");
  });

  it("keeps the lua decision arithmetic untouched by the telemetry edit", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    expect(source).toContain("if current + count <= limit then");
    expect(source).toContain("return {0, current}");
    expect(source).toContain("return {oldestScore + 60000 - now, current}");
    expect(source).toContain("return {1000, current}");
    expect(source).not.toContain("if current + count < limit then");
  });
});
