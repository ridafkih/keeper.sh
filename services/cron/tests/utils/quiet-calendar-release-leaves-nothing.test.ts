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
import { createScopedClaimPending } from "../../src/utils/scoped-drain-pending-ingest";

const ARGV_STRIDE = 3;
const HSET_STRIDE = 2;
const RELEASE_KEY_COUNT = 4;
const CLAIM_LIMIT = 10;
const FIRST_RECEIPT_MS = 1_000_000;
const LATER_RECEIPT_MS = 9_000_000;
const PRIOR_FAILURE_COUNT = "2";

/*
 * A primitive-level fake: every hash command a claim or a release could reasonably reach
 * for is real here, so the only thing under test is what production chooses to call. The
 * eval branch mirrors the Lua exactly as it stands today — an absent counter never
 * satisfies the compare-and-swap — because that retention rule is the webhook safety net.
 */
const createRedisFake = () => {
  const scores = new Map<string, number>();
  const hashes = new Map<string, Map<string, string>>();
  const reservations = new Set<string>();

  const hashAt = (key: string): Map<string, string> => {
    const existing = hashes.get(key);
    if (existing) {
      return existing;
    }
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };

  const incrementField = (key: string, field: string, by: number): number => {
    const next = Number(hashAt(key).get(field) ?? "0") + by;
    hashAt(key).set(field, String(next));
    return next;
  };

  const scoreOf = (calendarId: string): number =>
    scores.get(calendarId) ?? Number.POSITIVE_INFINITY;

  const deliverWebhook = (calendarId: string, receivedAtMs: number): void => {
    hashAt(PENDING_CORRELATION_KEY).set(calendarId, `corr-${receivedAtMs}`);
    incrementField(PENDING_REWAKE_KEY, calendarId, 1);
    if (receivedAtMs < scoreOf(calendarId)) {
      scores.set(calendarId, receivedAtMs);
    }
  };

  const runReleaseScript = (
    script: string,
    numKeys: number,
    ...rest: (string | number)[]
  ): Promise<unknown> => {
    if (script !== RELEASE_IF_UNCHANGED_SCRIPT) {
      throw new Error("release evaluated an unexpected script");
    }
    if (numKeys !== RELEASE_KEY_COUNT) {
      throw new Error(`release passed ${numKeys} keys, expected ${RELEASE_KEY_COUNT}`);
    }
    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    if (keys[0] !== PENDING_INGEST_KEY) {
      throw new Error(`KEYS[1] must be the pending set, got ${keys[0] ?? ""}`);
    }
    if (argv.length % ARGV_STRIDE !== 0) {
      throw new Error(`ARGV is not a member/rewake/score triple: ${argv.join(",")}`);
    }

    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += ARGV_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2] ?? "");
      const currentRewake = hashAt(keys[3] ?? "").get(member) ?? null;
      const unchanged = currentRewake !== null && currentRewake === claimedRewake;
      const currentScore = scores.get(member) ?? Number.POSITIVE_INFINITY;
      if (scores.has(member) && unchanged && currentScore <= claimedScore) {
        scores.delete(member);
        for (const key of keys.slice(1)) {
          hashAt(key).delete(member);
        }
        removed.push(member);
      }
    }

    return Promise.resolve(removed);
  };

  return {
    deliverWebhook,
    del: (...keys: string[]): Promise<number> => {
      for (const key of keys) {
        reservations.delete(key);
      }
      return Promise.resolve(keys.length);
    },
    eval: runReleaseScript,
    hashAt,
    hdel: (key: string, ...fields: string[]): Promise<number> => {
      for (const field of fields) {
        hashAt(key).delete(field);
      }
      return Promise.resolve(fields.length);
    },
    hget: (key: string, field: string): Promise<string | null> =>
      Promise.resolve(hashAt(key).get(field) ?? null),
    hincrby: (key: string, field: string, by: number): Promise<number> =>
      Promise.resolve(incrementField(key, field, by)),
    hmget: (key: string, ...fields: string[]): Promise<(string | null)[]> =>
      Promise.resolve(fields.map((field) => hashAt(key).get(field) ?? null)),
    hset: (key: string, ...pairs: string[]): Promise<number> => {
      for (let index = 0; index < pairs.length; index += HSET_STRIDE) {
        hashAt(key).set(pairs[index] ?? "", pairs[index + 1] ?? "");
      }
      return Promise.resolve(pairs.length / HSET_STRIDE);
    },
    hsetnx: (key: string, field: string, value: string): Promise<number> => {
      if (hashAt(key).has(field)) {
        return Promise.resolve(0);
      }
      hashAt(key).set(field, value);
      return Promise.resolve(1);
    },
    scores,
    set: (key: string): Promise<string | null> => {
      if (reservations.has(key)) {
        return Promise.resolve(null);
      }
      reservations.add(key);
      return Promise.resolve("OK");
    },
    zscore: (key: string, member: string): Promise<string | null> => {
      expect(key).toBe(PENDING_INGEST_KEY);
      if (!scores.has(member)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(String(scores.get(member)));
    },
  };
};

describe("a quiet calendar is still released and leaves nothing behind", () => {
  it("removes the member and every per-calendar field it accumulated", async () => {
    const redis = createRedisFake();
    redis.deliverWebhook("cal-quiet", FIRST_RECEIPT_MS);
    redis.hashAt(PENDING_FAILURES_KEY).set("cal-quiet", PRIOR_FAILURE_COUNT);

    const claimed = await createScopedClaimPending(redis, ["cal-quiet"])(CLAIM_LIMIT);
    const removed = await releaseUnchangedMembers(redis, claimed);

    expect(removed).toEqual(["cal-quiet"]);
    expect(redis.scores.has("cal-quiet")).toBe(false);
    expect(redis.hashAt(PENDING_CORRELATION_KEY).has("cal-quiet")).toBe(false);
    expect(redis.hashAt(PENDING_FAILURES_KEY).has("cal-quiet")).toBe(false);
    expect(redis.hashAt(PENDING_REWAKE_KEY).has("cal-quiet")).toBe(false);
  });

  /*
   * A member already pending when the counter shipped has no counter field, so the release
   * compare-and-swap can never match and the member is retained on every tick forever: it is
   * re-ingested every 10 seconds and its correlation and failure fields never go away. The
   * claim has to give such a member a counter to compare against, without ever weakening the
   * "absent at release means something changed" rule the retention test pins.
   */
  it("gives a pre-counter member something to compare, so a quiet one drains away", async () => {
    const redis = createRedisFake();
    redis.scores.set("cal-legacy", FIRST_RECEIPT_MS);
    redis.hashAt(PENDING_CORRELATION_KEY).set("cal-legacy", "corr-legacy");
    redis.hashAt(PENDING_FAILURES_KEY).set("cal-legacy", PRIOR_FAILURE_COUNT);

    const claimed = await createScopedClaimPending(redis, ["cal-legacy"])(CLAIM_LIMIT);
    const removed = await releaseUnchangedMembers(redis, claimed);

    expect(removed).toEqual(["cal-legacy"]);
    expect(redis.scores.has("cal-legacy")).toBe(false);
    expect(redis.hashAt(PENDING_CORRELATION_KEY).has("cal-legacy")).toBe(false);
    expect(redis.hashAt(PENDING_FAILURES_KEY).has("cal-legacy")).toBe(false);
    expect(redis.hashAt(PENDING_REWAKE_KEY).has("cal-legacy")).toBe(false);
  });

  it("still retains a pre-counter member that a webhook rewoke mid-ingest", async () => {
    const redis = createRedisFake();
    redis.scores.set("cal-legacy-busy", FIRST_RECEIPT_MS);

    const claimed = await createScopedClaimPending(redis, ["cal-legacy-busy"])(CLAIM_LIMIT);
    redis.deliverWebhook("cal-legacy-busy", LATER_RECEIPT_MS);

    const removed = await releaseUnchangedMembers(redis, claimed);

    expect(removed).toEqual([]);
    expect(redis.scores.get("cal-legacy-busy")).toBe(FIRST_RECEIPT_MS);
  });

  it("still retains a calendar that a webhook rewoke mid-ingest", async () => {
    const redis = createRedisFake();
    redis.deliverWebhook("cal-busy", FIRST_RECEIPT_MS);

    const claimed = await createScopedClaimPending(redis, ["cal-busy"])(CLAIM_LIMIT);
    redis.deliverWebhook("cal-busy", LATER_RECEIPT_MS);

    const removed = await releaseUnchangedMembers(redis, claimed);

    expect(removed).toEqual([]);
    expect(redis.scores.get("cal-busy")).toBe(FIRST_RECEIPT_MS);
    expect(redis.hashAt(PENDING_REWAKE_KEY).get("cal-busy")).toBe("2");
  });
});
