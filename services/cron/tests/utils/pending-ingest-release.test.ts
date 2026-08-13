import { describe, expect, it } from "vitest";
import {
  buildReleaseArguments,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  RELEASE_IF_UNCHANGED_SCRIPT,
  releaseUnchangedMembers,
} from "../../src/utils/pending-ingest-release";

const SCORE_STRIDE = 2;
const EXPECTED_KEY_COUNT = 2;

const createScriptRedis = (
  initialScores: [string, number][],
  initialFailures: [string, number][] = [],
) => {
  const scores = new Map(initialScores);
  const failures = new Map(initialFailures);

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
    if (argv.length % SCORE_STRIDE !== 0) {
      throw new Error(`ARGV is not a member/score pairing: ${argv.join(",")}`);
    }

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += SCORE_STRIDE) {
      const member = argv[index] ?? "";
      const claimedScore = Number(argv[index + 1]);
      if (!Number.isFinite(claimedScore)) {
        throw new TypeError(`ARGV score is not numeric for ${member}`);
      }
      const currentScore = scores.get(member) ?? null;
      if (currentScore !== null && currentScore <= claimedScore) {
        scores.delete(member);
        failures.delete(member);
        removed.push(member);
      }
    }

    return Promise.resolve(removed);
  };

  return { eval: eval_, failures, scores };
};

describe("buildReleaseArguments", () => {
  it("marshals members as a flat member-then-score pairing", () => {
    expect(buildReleaseArguments([
      { calendarId: "cal-1", score: 1000 },
      { calendarId: "cal-2", score: 2000 },
    ])).toEqual(["cal-1", "1000", "cal-2", "2000"]);
  });

  it("emits nothing for an empty claim", () => {
    expect(buildReleaseArguments([])).toEqual([]);
  });
});

describe("releaseUnchangedMembers", () => {
  it("removes only members whose score is unchanged since the claim", async () => {
    const redis = createScriptRedis(
      [["cal-1", 2000], ["cal-2", 1000]],
      [["cal-1", 3], ["cal-2", 2]],
    );

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-1", score: 1000 },
      { calendarId: "cal-2", score: 1000 },
    ]);

    expect(removed).toEqual(["cal-2"]);
    expect([...redis.scores.keys()]).toEqual(["cal-1"]);
    expect([...redis.failures.keys()]).toEqual(["cal-1"]);
  });

  it("ignores a member that is no longer pending", async () => {
    const redis = createScriptRedis([["cal-1", 1000]]);

    const removed = await releaseUnchangedMembers(redis, [
      { calendarId: "cal-1", score: 1000 },
      { calendarId: "cal-gone", score: 1000 },
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
      [{ calendarId: "cal-1", score: 1000 }],
    );

    expect(removed).toEqual([]);
  });
});

describe("RELEASE_IF_UNCHANGED_SCRIPT", () => {
  it("walks ARGV in member/score pairs and touches both keys", () => {
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("for index = 1, #ARGV, 2 do");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ARGV[index + 1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ZSCORE', KEYS[1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("ZREM', KEYS[1]");
    expect(RELEASE_IF_UNCHANGED_SCRIPT).toContain("HDEL', KEYS[2]");
  });
});
