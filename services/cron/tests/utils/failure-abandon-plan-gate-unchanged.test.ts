import { beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_REWAKE_KEY } from "@keeper.sh/calendar";
import type {
  DrainPendingIngestDependencies,
  ResolvedPendingCalendar,
} from "../../src/utils/drain-pending-ingest";

const RELEASE_KEY_COUNT = 4;
const SCORE_STRIDE = 3;

interface StringEntry {
  expiresAt: number;
  value: string;
}

const clock = { nowMs: 1_700_000_000_000 };
const zsets = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, StringEntry>();
const locks = new Map<string, string>();

const readZset = (key: string): Map<string, number> => {
  const existing = zsets.get(key) ?? new Map<string, number>();
  zsets.set(key, existing);
  return existing;
};

const readHash = (key: string): Map<string, string> => {
  const existing = hashes.get(key) ?? new Map<string, string>();
  hashes.set(key, existing);
  return existing;
};

const readLiveString = (key: string): string | null => {
  if (!strings.has(key)) {
    return null;
  }
  const entry = strings.get(key) ?? { expiresAt: 0, value: "" };
  if (entry.expiresAt <= clock.nowMs) {
    strings.delete(key);
    return null;
  }
  return entry.value;
};

const resolveBound = (bound: number, length: number): number => {
  if (bound < 0) {
    return length + bound;
  }
  return bound;
};

const fakeRedis = {
  del: (...keys: string[]): Promise<number> => {
    let removed = 0;
    for (const key of keys) {
      if (strings.delete(key)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  },
  eval: (
    _script: string,
    numKeys: number,
    ...rest: (string | number)[]
  ): Promise<unknown> => {
    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    const pendingKey = keys[0] ?? "";
    if (numKeys !== RELEASE_KEY_COUNT || argv.length % SCORE_STRIDE !== 0) {
      throw new Error(
        `Fake redis cannot evaluate a script of ${numKeys} keys and ${argv.length} args`,
      );
    }

    const scores = readZset(pendingKey);
    const failures = readHash(keys[1] ?? "");
    const correlations = readHash(keys[2] ?? "");
    const rewakes = readHash(keys[3] ?? "");
    const removed: string[] = [];
    for (let index = 0; index < argv.length; index += SCORE_STRIDE) {
      const member = argv[index] ?? "";
      const claimedRewake = argv[index + 1] ?? "";
      const claimedScore = Number(argv[index + 2] ?? "");
      const currentRewake = rewakes.get(member) ?? null;
      const currentScore = scores.get(member) ?? Number.POSITIVE_INFINITY;
      if (scores.has(member) && currentRewake !== null
        && currentRewake === claimedRewake && currentScore <= claimedScore) {
        scores.delete(member);
        failures.delete(member);
        correlations.delete(member);
        rewakes.delete(member);
        removed.push(member);
      }
    }
    return Promise.resolve(removed);
  },
  expire: (): Promise<number> => Promise.resolve(1),
  get: (key: string): Promise<string | null> => Promise.resolve(readLiveString(key)),
  hdel: (key: string, ...fields: string[]): Promise<number> => {
    const hash = readHash(key);
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  },
  hget: (key: string, field: string): Promise<string | null> =>
    Promise.resolve(readHash(key).get(field) ?? null),
  hincrby: (key: string, field: string, by: number): Promise<number> => {
    const next = Number(readHash(key).get(field) ?? 0) + by;
    readHash(key).set(field, String(next));
    return Promise.resolve(next);
  },
  hmget: (key: string, ...fields: string[]): Promise<(string | null)[]> =>
    Promise.resolve(fields.map((field) => readHash(key).get(field) ?? null)),
  hset: (key: string, field: string, value: string): Promise<number> => {
    readHash(key).set(field, value);
    return Promise.resolve(1);
  },
  pexpire: (): Promise<number> => Promise.resolve(1),
  sadd: (key: string, ...members: string[]): Promise<number> => {
    const set = readHash(key);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.set(member, "1");
        added += 1;
      }
    }
    return Promise.resolve(added);
  },
  set: (
    key: string,
    value: string,
    ...options: (string | number)[]
  ): Promise<string | null> => {
    const tokens = options.map(String);
    const wantsAbsent = tokens.some((token) => token.toUpperCase() === "NX");
    if (wantsAbsent && readLiveString(key) !== null) {
      return Promise.resolve(null);
    }
    const ttlIndex = tokens.findIndex((token) => token.toUpperCase() === "PX");
    let expiresAt = Number.POSITIVE_INFINITY;
    if (ttlIndex !== -1) {
      expiresAt = clock.nowMs + Number(tokens[ttlIndex + 1]);
    }
    strings.set(key, { expiresAt, value });
    return Promise.resolve("OK");
  },
  sismember: (key: string, member: string): Promise<number> => {
    if (readHash(key).has(member)) {
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  },
  smembers: (key: string): Promise<string[]> => Promise.resolve([...readHash(key).keys()]),
  srem: (key: string, ...members: string[]): Promise<number> => {
    const set = readHash(key);
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  },
  zadd: (key: string, score: number, member: string): Promise<number> => {
    readZset(key).set(member, score);
    return Promise.resolve(1);
  },
  zcard: (key: string): Promise<number> => Promise.resolve(readZset(key).size),
  zrange: (
    key: string,
    start: number,
    stop: number,
    mode?: string,
  ): Promise<string[]> => {
    const entries = [...readZset(key).entries()].toSorted(
      (left, right) => left[1] - right[1],
    );
    const sliced = entries.slice(
      resolveBound(start, entries.length),
      resolveBound(stop, entries.length) + 1,
    );
    if (String(mode).toUpperCase() === "WITHSCORES") {
      return Promise.resolve(sliced.flatMap(([member, score]) => [member, String(score)]));
    }
    return Promise.resolve(sliced.map(([member]) => member));
  },
  zrem: (key: string, ...members: string[]): Promise<number> => {
    const scores = readZset(key);
    let removed = 0;
    for (const member of members) {
      if (scores.delete(member)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  },
  zscore: (key: string, member: string): Promise<string | null> => {
    const scores = readZset(key);
    if (!scores.has(member)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(String(scores.get(member) ?? 0));
  },
};

const fakeLockStore = {
  release: (key: string): Promise<void> => {
    locks.delete(key);
    return Promise.resolve();
  },
  tryAcquire: (key: string): Promise<boolean> => {
    if (locks.has(key)) {
      return Promise.resolve(false);
    }
    locks.set(key, "held");
    return Promise.resolve(true);
  },
};

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key", WEBHOOK_PUBLIC_URL: "https://www.example.com" },
}));
vi.mock("../../src/context", () => ({
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: fakeRedis,
  refreshLockStore: fakeLockStore,
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/jobs/ingest-sources", () => ({
  ingestOAuthSources: () => Promise.resolve({ affectedUserIds: [] }),
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const { PENDING_FAILURES_KEY, PENDING_INGEST_KEY } = await import(
  "../../src/utils/pending-ingest-release"
);

const wakePending = (calendarId: string, score: number): void => {
  readZset(PENDING_INGEST_KEY).set(calendarId, score);
  const rewakes = readHash(PENDING_REWAKE_KEY);
  rewakes.set(calendarId, String(Number(rewakes.get(calendarId) ?? 0) + 1));
};
const { MAX_PENDING_FAILURES, runDrainPendingIngest } = await import(
  "../../src/utils/drain-pending-ingest"
);
const { createDefaultDependencies } = await import("../../src/jobs/drain-pending-ingest");
const { buildClaimKey } = await import("../../src/utils/pending-ingest-claim");

const USER_BY_CALENDAR: Record<string, string> = {
  "cal-free": "user-free",
  "cal-pro": "user-pro",
};

const PLAN_BY_USER: Record<string, "free" | "pro"> = {
  "user-free": "free",
  "user-pro": "pro",
};

const resolveCalendars = (calendarIds: string[]): Promise<ResolvedPendingCalendar[]> =>
  Promise.resolve(calendarIds.flatMap((calendarId) => {
    const userId = USER_BY_CALENDAR[calendarId] ?? "";
    if (userId.length === 0) {
      return [];
    }
    return [{ calendarId, userId }];
  }));

const overrides = (
  ingestCalendars: DrainPendingIngestDependencies["ingestCalendars"],
): Partial<DrainPendingIngestDependencies> => ({
  enqueueDestinationSyncs: () => Promise.resolve(),
  ingestCalendars,
  now: () => new Date(clock.nowMs),
  observe: () => null,
  resolveCalendars,
  resolvePlan: (userId) => Promise.resolve(PLAN_BY_USER[userId] ?? "pro"),
});

const readFailureCount = async (calendarId: string): Promise<number> =>
  Number(await fakeRedis.hget(PENDING_FAILURES_KEY, calendarId) ?? 0);

beforeEach(() => {
  clock.nowMs = 1_700_000_000_000;
  zsets.clear();
  hashes.clear();
  strings.clear();
  locks.clear();
});

describe("failure, abandon and the plan gate are unchanged", () => {
  it("accrues a failure per pass and abandons the calendar at the threshold", async () => {
    const attempts: string[][] = [];
    const failureCounts: number[] = [];
    const recordedSlugs: string[] = [];
    const ingestFailed = new Error("source ingest rejected");

    wakePending("cal-pro", clock.nowMs - 1000);

    for (let pass = 0; pass < MAX_PENDING_FAILURES; pass += 1) {
      const baseDependencies = await createDefaultDependencies();
      const attempted: string[] = [];
      await runDrainPendingIngest({
        ...baseDependencies,
        ...overrides((calendarIds) => {
          attempted.push(...calendarIds);
          return Promise.reject(ingestFailed);
        }),
        recordError: (_error, slug) => {
          recordedSlugs.push(slug);
        },
      });
      attempts.push(attempted);
      failureCounts.push(await readFailureCount("cal-pro"));
      clock.nowMs += 10_000;
    }

    expect(attempts).toEqual([
      ["cal-pro"],
      ["cal-pro"],
      ["cal-pro"],
      ["cal-pro"],
      ["cal-pro"],
    ]);
    expect(failureCounts).toEqual([1, 2, 3, 4, 0]);
    expect(recordedSlugs).toHaveLength(MAX_PENDING_FAILURES);
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-pro")).toBeNull();
    expect(await fakeRedis.hget(PENDING_FAILURES_KEY, "cal-pro")).toBeNull();
    expect(await fakeRedis.get(buildClaimKey("cal-pro"))).toBeNull();
  });

  it("gates the ingest by plan and charges the skipped calendar no failure", async () => {
    const attempted: string[] = [];
    const recordedSlugs: string[] = [];

    wakePending("cal-free", clock.nowMs - 2000);
    wakePending("cal-pro", clock.nowMs - 1000);

    const baseDependencies = await createDefaultDependencies();
    await runDrainPendingIngest({
      ...baseDependencies,
      ...overrides((calendarIds) => {
        attempted.push(...calendarIds);
        return Promise.resolve({ affectedUserIds: ["user-pro"] });
      }),
      recordError: (_error, slug) => {
        recordedSlugs.push(slug);
      },
    });

    expect(attempted).toEqual(["cal-pro"]);
    expect(recordedSlugs).toEqual([]);
    expect(await readFailureCount("cal-free")).toBe(0);
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-free")).toBeNull();
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-pro")).toBeNull();

    const rewokenScore = clock.nowMs + 1000;
    wakePending("cal-free", rewokenScore);
    clock.nowMs += 10_000;

    const laterAttempted: string[] = [];
    const laterDependencies = await createDefaultDependencies();
    const claimedAgain: string[] = [];
    await runDrainPendingIngest({
      ...laterDependencies,
      ...overrides((calendarIds) => {
        laterAttempted.push(...calendarIds);
        return Promise.resolve({ affectedUserIds: [] });
      }),
      claimPending: async (limit) => {
        const claimed = await laterDependencies.claimPending(limit);
        claimedAgain.push(...claimed.map((member) => member.calendarId));
        return claimed;
      },
      recordError: (_error, slug) => {
        recordedSlugs.push(slug);
      },
    });

    expect(claimedAgain).toEqual(["cal-free"]);
    expect(laterAttempted).toEqual([]);
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-free")).toBeNull();
    expect(recordedSlugs).toEqual([]);
  });

  it("fails and abandons a calendar whose plan lookup keeps rejecting", async () => {
    const attempted: string[] = [];
    const failureCounts: number[] = [];
    const planUnavailable = new Error("plan lookup unavailable");

    wakePending("cal-pro", clock.nowMs - 1000);

    for (let pass = 0; pass < MAX_PENDING_FAILURES; pass += 1) {
      const baseDependencies = await createDefaultDependencies();
      await runDrainPendingIngest({
        ...baseDependencies,
        ...overrides((calendarIds) => {
          attempted.push(...calendarIds);
          return Promise.resolve({ affectedUserIds: [] });
        }),
        recordError: () => null,
        resolvePlan: () => Promise.reject(planUnavailable),
      });
      failureCounts.push(await readFailureCount("cal-pro"));
      clock.nowMs += 10_000;
    }

    expect(attempted).toEqual([]);
    expect(failureCounts).toEqual([1, 2, 3, 4, 0]);
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-pro")).toBeNull();
  });
});
