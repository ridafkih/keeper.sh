import { describe, expect, it } from "vitest";
import {
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
} from "@keeper.sh/calendar";
import {
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
} from "../../src/utils/pending-ingest-release";
import { readClaimMetadata } from "../../src/utils/scoped-drain-pending-ingest";

const ARGV_STRIDE = 3;
const LEGACY_SCORE_MS = 1_700_000;
const HSETNX_WROTE = 1;
const HSETNX_SKIPPED = 0;

const createDeployedRedis = () => {
  const scores = new Map<string, number>();
  const correlations = new Map<string, string>();
  const failures = new Map<string, number>();
  const rewakes = new Map<string, string>();

  const hmget = (key: string, ...members: string[]): Promise<(string | null)[]> => {
    if (key === PENDING_REWAKE_KEY) {
      return Promise.resolve(members.map((member) => rewakes.get(member) ?? null));
    }
    expect(key).toBe(PENDING_CORRELATION_KEY);
    return Promise.resolve(members.map((member) => correlations.get(member) ?? null));
  };

  const hsetnx = (key: string, member: string, value: string): Promise<number> => {
    expect(key).toBe(PENDING_REWAKE_KEY);
    if (rewakes.has(member)) {
      return Promise.resolve(HSETNX_SKIPPED);
    }
    rewakes.set(member, value);
    return Promise.resolve(HSETNX_WROTE);
  };

  const evaluate = (
    script: string,
    numKeys: number,
    ...rest: (string | number)[]
  ): Promise<unknown> => {
    expect(script).toBe(RELEASE_IF_UNCHANGED_SCRIPT);
    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    expect(keys).toEqual([
      PENDING_INGEST_KEY,
      PENDING_FAILURES_KEY,
      PENDING_CORRELATION_KEY,
      PENDING_REWAKE_KEY,
    ]);

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += ARGV_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2] ?? "");
      const currentRewake = rewakes.get(member) ?? null;
      const unchanged = currentRewake !== null && currentRewake === claimedRewake;
      const currentScore = scores.get(member) ?? Number.POSITIVE_INFINITY;
      if (scores.has(member) && unchanged && currentScore <= claimedScore) {
        scores.delete(member);
        failures.delete(member);
        correlations.delete(member);
        rewakes.delete(member);
        removed.push(member);
      }
    }
    return Promise.resolve(removed);
  };

  return { correlations, eval: evaluate, failures, hmget, hsetnx, rewakes, scores };
};

describe("a calendar pending from before the deploy is not dropped", () => {
  it("retains a claimed member whose rewake counter was never written", async () => {
    const redis = createDeployedRedis();
    redis.scores.set("cal-legacy", LEGACY_SCORE_MS);
    redis.correlations.set("cal-legacy", "corr-legacy");

    const claimed = await readClaimMetadata(redis, [
      { calendarId: "cal-legacy", score: LEGACY_SCORE_MS },
    ]);

    const removed = await releaseUnchangedMembers(redis, claimed);

    expect(removed).toEqual([]);
    expect(redis.scores.has("cal-legacy")).toBe(true);
    expect(redis.correlations.get("cal-legacy")).toBe("corr-legacy");
  });
});
