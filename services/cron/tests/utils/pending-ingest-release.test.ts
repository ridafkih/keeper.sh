import { describe, expect, it } from "vitest";
import {
  buildReleaseArguments,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
} from "../../src/utils/pending-ingest-release";

const REWAKE_STRIDE = 3;
const EXPECTED_KEY_COUNT = 4;
const FIRST_DELIVERY = "1";

const createScriptRedis = (
  initialScores: [string, number][],
  initialFailures: [string, number][] = [],
) => {
  const scores = new Map(initialScores);
  const failures = new Map(initialFailures);
  const rewakes = new Map(
    initialScores.map(([calendarId]) => [calendarId, FIRST_DELIVERY]),
  );

  const eval_ = (
    script: string,
    numKeys: number,
    ...rest: (string | number)[]
  ): Promise<unknown> => {
    if (script !== RELEASE_IF_UNCHANGED_SCRIPT) {
      throw new Error("unexpected script");
    }
    if (numKeys !== EXPECTED_KEY_COUNT) {
      throw new Error(`expected ${EXPECTED_KEY_COUNT} keys, received ${numKeys}`);
    }

    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    if (keys[0] !== PENDING_INGEST_KEY || keys[1] !== PENDING_FAILURES_KEY) {
      throw new Error(`unexpected keys ${keys.join(",")}`);
    }
    if (keys[3] !== PENDING_REWAKE_KEY) {
      throw new Error(`unexpected rewake key ${keys[3] ?? ""}`);
    }
    if (argv.length % REWAKE_STRIDE !== 0) {
      throw new Error(`ARGV is not a member/rewake/score triple: ${argv.join(",")}`);
    }

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += REWAKE_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2] ?? "");
      const currentRewake = rewakes.get(member) ?? null;
      const currentScore = scores.get(member) ?? Number.POSITIVE_INFINITY;
      if (scores.has(member) && currentRewake !== null
        && currentRewake === claimedRewake && currentScore <= claimedScore) {
        scores.delete(member);
        failures.delete(member);
        rewakes.delete(member);
        removed.push(member);
      }
    }

    return Promise.resolve(removed);
  };

  return { eval: eval_, failures, rewakes, scores };
};

describe("buildReleaseArguments", () => {
  it("marshals members as a flat member, rewake and score triple", () => {
    expect(buildReleaseArguments([
      { calendarId: "cal-1", rewake: "3", score: 1000 },
      { calendarId: "cal-2", rewake: "1", score: 2000 },
    ])).toEqual(["cal-1", "3", "1000", "cal-2", "1", "2000"]);
  });

  it("marshals a member claimed before the counter existed as an empty rewake", () => {
    expect(buildReleaseArguments([
      { calendarId: "cal-1", score: 1000 },
    ])).toEqual(["cal-1", "", "1000"]);
  });

  it("emits nothing for an empty claim", () => {
    expect(buildReleaseArguments([])).toEqual([]);
  });
});

describe("releaseUnchangedMembers", () => {
  it("removes only members whose rewake counter is unchanged since the claim", async () => {
    const redis = createScriptRedis(
      [["cal-1", 2000], ["cal-2", 1000]],
      [["cal-1", 3], ["cal-2", 2]],
    );
    redis.rewakes.set("cal-1", "2");

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-1", rewake: FIRST_DELIVERY, score: 1000 },
      { calendarId: "cal-2", rewake: FIRST_DELIVERY, score: 1000 },
    ]);

    expect(removed).toEqual(["cal-2"]);
    expect([...redis.scores.keys()]).toEqual(["cal-1"]);
    expect([...redis.failures.keys()]).toEqual(["cal-1"]);
    expect([...redis.rewakes.keys()]).toEqual(["cal-1"]);
  });

  it("ignores a member that is no longer pending", async () => {
    const redis = createScriptRedis([["cal-1", 1000]]);

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-1", rewake: FIRST_DELIVERY, score: 1000 },
      { calendarId: "cal-gone", rewake: FIRST_DELIVERY, score: 1000 },
    ]);

    expect(removed).toEqual(["cal-1"]);
  });

  it("never evaluates the script for an empty claim", async () => {
    const redis = createScriptRedis([["cal-1", 1000]]);
    let evaluated = false;

    const removed = await releaseUnchangedMembers(
      {
        eval: (...args: Parameters<typeof redis.eval>) => {
          evaluated = true;
          return redis.eval(...args);
        },
      },
      [],
    );

    expect(removed).toEqual([]);
    expect(evaluated).toBe(false);
  });

  it("returns an empty release when the script yields a non-array", async () => {
    const removed = await releaseUnchangedMembers(
      { eval: () => Promise.resolve(null) },
      [{ calendarId: "cal-1", rewake: FIRST_DELIVERY, score: 1000 }],
    );

    expect(removed).toEqual([]);
  });
});

describe("RELEASE_IF_UNCHANGED_SCRIPT", () => {
  it("walks ARGV in member, rewake and score triples and touches every key", () => {
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("for index = 1, #ARGV, 3 do");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index + 1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index + 2]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ZSCORE', KEYS[1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ZREM', KEYS[1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HDEL', KEYS[2]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HGET', KEYS[4]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HDEL', KEYS[4]");
  });
});
