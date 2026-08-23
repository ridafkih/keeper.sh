import { describe, expect, it } from "vitest";
import {
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
} from "../../src/utils/pending-ingest-release";

const ARGV_STRIDE = 3;
const REQUIRED_KEY_COUNT = 4;
const CLAIM_SCORE_MS = 1_000_000;
const OLD_REPLICA_DELIVERY_MS = 9_000_000;
const FIRST_DELIVERY = "1";

const createReleaseRedis = () => {
  const scores = new Map<string, number>();
  const correlations = new Map<string, string>();
  const failures = new Map<string, number>();
  const counters = new Map<string, string>();

  const deliverFromNewReplica = (calendarId: string, receivedAtMs: number): void => {
    const stored = scores.get(calendarId) ?? Number.POSITIVE_INFINITY;
    if (receivedAtMs < stored) {
      scores.set(calendarId, receivedAtMs);
    }
    const previous = Number(counters.get(calendarId) ?? "0");
    counters.set(calendarId, String(previous + 1));
  };

  const deliverFromOldReplica = (calendarId: string, receivedAtMs: number): void => {
    scores.set(calendarId, receivedAtMs);
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
      throw new Error(`release must stay a ${REQUIRED_KEY_COUNT}-key eval; got ${numKeys}`);
    }
    const expectedKeys = [
      PENDING_INGEST_KEY,
      PENDING_FAILURES_KEY,
      PENDING_CORRELATION_KEY,
      PENDING_REWAKE_KEY,
    ];
    if (keys.join(",") !== expectedKeys.join(",")) {
      throw new Error(`unexpected keys ${keys.join(",")}`);
    }
    if (argv.length % ARGV_STRIDE !== 0) {
      throw new Error(`ARGV is not a member/rewake/score triple: ${argv.join(",")}`);
    }

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += ARGV_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2]);
      const currentRewake = counters.get(member) ?? null;
      const currentScore = scores.get(member) ?? null;
      const rewakeUnchanged = currentRewake !== null && currentRewake === claimedRewake;
      const scoreUnchanged = currentScore !== null && currentScore <= claimedScore;
      if (rewakeUnchanged && scoreUnchanged) {
        scores.delete(member);
        failures.delete(member);
        correlations.delete(member);
        counters.delete(member);
        removed.push(member);
      }
    }

    return Promise.resolve(removed);
  };

  return {
    correlations,
    counters,
    deliverFromNewReplica,
    deliverFromOldReplica,
    eval: evaluate,
    failures,
    scores,
  };
};

describe("a score that moves without the counter still retains", () => {
  it("retains a claimed calendar whose score an old replica moved without the counter", async () => {
    const redis = createReleaseRedis();
    redis.deliverFromNewReplica("cal-1", CLAIM_SCORE_MS);
    redis.correlations.set("cal-1", "corr-1");
    const claimed = {
      calendarId: "cal-1",
      rewake: redis.counters.get("cal-1") ?? "",
      score: CLAIM_SCORE_MS,
    };

    redis.deliverFromOldReplica("cal-1", OLD_REPLICA_DELIVERY_MS);

    expect(redis.counters.get("cal-1")).toBe(claimed.rewake);
    expect(redis.scores.get("cal-1")).toBe(OLD_REPLICA_DELIVERY_MS);

    const removed = await releaseUnchangedMembers(redis, [claimed]);

    expect(removed).toEqual([]);
    expect(redis.scores.get("cal-1")).toBe(OLD_REPLICA_DELIVERY_MS);
    expect(redis.counters.get("cal-1")).toBe(FIRST_DELIVERY);
    expect(redis.correlations.get("cal-1")).toBe("corr-1");
  });

  it("marshals the claimed score beside the member and its rewake counter", async () => {
    const redis = createReleaseRedis();
    redis.deliverFromNewReplica("cal-quiet", CLAIM_SCORE_MS);

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-quiet", rewake: FIRST_DELIVERY, score: CLAIM_SCORE_MS },
    ]);

    expect(removed).toEqual(["cal-quiet"]);
    expect(redis.scores.has("cal-quiet")).toBe(false);
    expect(redis.counters.has("cal-quiet")).toBe(false);
  });

  it("compares the claimed score inside the one release script", () => {
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("for index = 1, #ARGV, 3 do");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index + 2]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ZSCORE', KEYS[1]");
  });
});
