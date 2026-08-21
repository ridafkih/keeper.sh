import { describe, expect, it } from "vitest";
import {
  buildReleaseArguments,
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
} from "../../src/utils/pending-ingest-release";

const ARGV_STRIDE = 3;
const REQUIRED_KEY_COUNT = 4;
const CLAIM_SCORE_MS = 1_000_000;
const LATER_DELIVERY_MS = 9_000_000;

const createRewakeRedis = () => {
  const scores = new Map<string, number>();
  const correlations = new Map<string, string>();
  const failures = new Map<string, number>();
  const counters = new Map<string, string>();

  const deliver = (calendarId: string, receivedAtMs: number): void => {
    const stored = scores.get(calendarId) ?? Number.POSITIVE_INFINITY;
    if (receivedAtMs < stored) {
      scores.set(calendarId, receivedAtMs);
    }
    const previous = Number(counters.get(calendarId) ?? "0");
    counters.set(calendarId, String(previous + 1));
  };

  const evaluate = (
    script: string,
    numKeys: number,
    ...rest: (string | number)[]
  ): Promise<unknown> => {
    if (script !== RELEASE_IF_UNCHANGED_SCRIPT) {
      throw new Error("unexpected script");
    }
    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    if (numKeys !== REQUIRED_KEY_COUNT) {
      throw new Error(
        `release must pass the per-calendar rewake counter key as KEYS[4]; got ${numKeys} keys: ${keys.join(",")}`,
      );
    }
    const rewakeKey = keys[3] ?? "";
    const knownKeys = [PENDING_INGEST_KEY, PENDING_FAILURES_KEY, PENDING_CORRELATION_KEY];
    if (rewakeKey === "" || knownKeys.includes(rewakeKey)) {
      throw new Error(`KEYS[4] must be a dedicated rewake key; got "${rewakeKey}"`);
    }
    if (argv.length % ARGV_STRIDE !== 0) {
      throw new Error(`ARGV is not a member/rewake/score triple: ${argv.join(",")}`);
    }

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += ARGV_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2] ?? "");
      const currentRewake = counters.get(member) ?? null;
      const unchanged = currentRewake !== null && currentRewake === claimedRewake;
      const currentScore = scores.get(member) ?? Number.POSITIVE_INFINITY;
      if (scores.has(member) && unchanged && currentScore <= claimedScore) {
        scores.delete(member);
        failures.delete(member);
        correlations.delete(member);
        counters.delete(member);
        removed.push(member);
      }
    }

    return Promise.resolve(removed);
  };

  return { correlations, counters, deliver, eval: evaluate, failures, scores };
};

describe("a webhook landing mid-ingest still retains the calendar", () => {
  it("carries the claimed rewake counter alongside the score into the release CAS", () => {
    expect(buildReleaseArguments([
      { calendarId: "cal-1", rewake: "7", score: CLAIM_SCORE_MS },
      { calendarId: "cal-2", rewake: "1", score: CLAIM_SCORE_MS },
    ])).toEqual([
      "cal-1", "7", String(CLAIM_SCORE_MS),
      "cal-2", "1", String(CLAIM_SCORE_MS),
    ]);
  });

  it("retains a claimed calendar when a later delivery writes no score", async () => {
    const redis = createRewakeRedis();
    redis.deliver("cal-1", CLAIM_SCORE_MS);
    redis.correlations.set("cal-1", "corr-1");
    const claimed = {
      calendarId: "cal-1",
      rewake: redis.counters.get("cal-1") ?? "",
      score: CLAIM_SCORE_MS,
    };

    redis.deliver("cal-1", LATER_DELIVERY_MS);

    expect(redis.scores.get("cal-1")).toBe(CLAIM_SCORE_MS);

    const removed = await releaseUnchangedMembers(redis, [claimed]);

    expect(removed).toEqual([]);
    expect(redis.scores.has("cal-1")).toBe(true);
    expect(redis.correlations.get("cal-1")).toBe("corr-1");
  });

  it("releases and cleans up the rewake counter when nothing landed mid-ingest", async () => {
    const redis = createRewakeRedis();
    redis.deliver("cal-1", CLAIM_SCORE_MS);
    redis.correlations.set("cal-1", "corr-1");
    redis.failures.set("cal-1", 2);
    const claimed = {
      calendarId: "cal-1",
      rewake: redis.counters.get("cal-1") ?? "",
      score: CLAIM_SCORE_MS,
    };

    const removed = await releaseUnchangedMembers(redis, [claimed]);

    expect(removed).toEqual(["cal-1"]);
    expect(redis.scores.has("cal-1")).toBe(false);
    expect(redis.counters.has("cal-1")).toBe(false);
    expect(redis.failures.has("cal-1")).toBe(false);
    expect(redis.correlations.has("cal-1")).toBe(false);
  });

  it("retains a claimed calendar whose counter is absent from before the deploy", async () => {
    const redis = createRewakeRedis();
    redis.scores.set("cal-legacy", CLAIM_SCORE_MS);

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-legacy", rewake: "", score: CLAIM_SCORE_MS },
    ]);

    expect(removed).toEqual([]);
    expect(redis.scores.has("cal-legacy")).toBe(true);
  });

  it("compares the rewake counter and cleans it inside the one release script", () => {
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("KEYS[4]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HGET");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HDEL', KEYS[4]");
  });
});
