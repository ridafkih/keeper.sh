import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_REWAKE_KEY } from "@keeper.sh/calendar";
import type {
  DrainPendingIngestDependencies,
  ResolvedPendingCalendar,
} from "../../src/utils/drain-pending-ingest";

const RELEASE_KEY_COUNT = 4;
const SCORE_STRIDE = 3;
const STRAND_HORIZON_MS = 1_800_000;

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
  hsetnx: (key: string, field: string, value: string): Promise<number> => {
    const hash = readHash(key);
    if (hash.has(field)) {
      return Promise.resolve(0);
    }
    hash.set(field, value);
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

const { PENDING_INGEST_KEY } = await import("../../src/utils/pending-ingest-release");

const wakePending = (calendarId: string, score: number): void => {
  readZset(PENDING_INGEST_KEY).set(calendarId, score);
  const rewakes = readHash(PENDING_REWAKE_KEY);
  rewakes.set(calendarId, String(Number(rewakes.get(calendarId) ?? 0) + 1));
};
const { runDrainPendingIngest } = await import("../../src/utils/drain-pending-ingest");
const { createDefaultDependencies } = await import("../../src/jobs/drain-pending-ingest");
const { createScopedClaimPending } = await import(
  "../../src/utils/scoped-drain-pending-ingest"
);

const USER_BY_CALENDAR: Record<string, string> = {
  "cal-a": "user-a",
  "cal-b": "user-b",
  "cal-c": "user-c",
};

const noop = (): null => null;

const createDeferred = (): { promise: Promise<void>; settle: () => void } => {
  let settle: () => void = noop;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: () => settle() };
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
  resolvePlan: () => Promise.resolve("pro"),
});

const runTick = async (
  ingested: string[],
  recordedErrors: unknown[],
): Promise<void> => {
  const baseDependencies = await createDefaultDependencies();
  await runDrainPendingIngest({
    ...baseDependencies,
    ...overrides((calendarIds) => {
      ingested.push(...calendarIds);
      return Promise.resolve({ affectedUserIds: [] });
    }),
    recordError: (error) => {
      recordedErrors.push(error);
    },
  });
};

beforeEach(() => {
  clock.nowMs = 1_700_000_000_000;
  zsets.clear();
  hashes.clear();
  strings.clear();
  locks.clear();
  wakePending("cal-a", clock.nowMs - 3000);
  wakePending("cal-b", clock.nowMs - 2000);
  wakePending("cal-c", clock.nowMs - 1000);
});

describe("a reservation cannot strand a calendar", () => {
  it("hands the calendar back once the reservation ages past its bound", async () => {
    const recordedErrors: unknown[] = [];
    const strandedIngests: string[] = [];
    const ingestEntered = createDeferred();
    const neverReturns = createDeferred();

    const baseDependencies = await createDefaultDependencies();
    const strandedDrain = runDrainPendingIngest({
      ...baseDependencies,
      ...overrides(async (calendarIds) => {
        strandedIngests.push(...calendarIds);
        ingestEntered.settle();
        await neverReturns.promise;
        return { affectedUserIds: [] };
      }),
      claimPending: createScopedClaimPending(fakeRedis, ["cal-a"]),
      recordError: (error) => {
        recordedErrors.push(error);
      },
    });

    await ingestEntered.promise;
    expect(strandedIngests).toEqual(["cal-a"]);

    const siblingIngests: string[] = [];
    await runTick(siblingIngests, recordedErrors);
    expect(siblingIngests.toSorted()).toEqual(["cal-b", "cal-c"]);

    clock.nowMs += INGEST_SOURCE_TIMEOUT_MS;
    const deadlineIngests: string[] = [];
    await runTick(deadlineIngests, recordedErrors);
    expect(deadlineIngests).toEqual([]);

    clock.nowMs += STRAND_HORIZON_MS;
    const recoveredIngests: string[] = [];
    await runTick(recoveredIngests, recordedErrors);
    expect(recoveredIngests).toEqual(["cal-a"]);
    expect(recordedErrors).toEqual([]);

    neverReturns.settle();
    await strandedDrain;
  });

  it("keeps a webhook that lands mid-ingest and drains it on a later pass", async () => {
    const recordedErrors: unknown[] = [];
    const signalledIngests: string[] = [];
    const ingestEntered = createDeferred();
    const ingestHeld = createDeferred();

    const baseDependencies = await createDefaultDependencies();
    const signalledDrain = runDrainPendingIngest({
      ...baseDependencies,
      ...overrides(async (calendarIds) => {
        signalledIngests.push(...calendarIds);
        ingestEntered.settle();
        await ingestHeld.promise;
        return { affectedUserIds: [] };
      }),
      claimPending: createScopedClaimPending(fakeRedis, ["cal-a"]),
      recordError: (error) => {
        recordedErrors.push(error);
      },
    });

    await ingestEntered.promise;

    const rewokenScore = clock.nowMs + 500;
    wakePending("cal-a", rewokenScore);

    const siblingIngests: string[] = [];
    await runTick(siblingIngests, recordedErrors);
    expect(siblingIngests.toSorted()).toEqual(["cal-b", "cal-c"]);

    ingestHeld.settle();
    await signalledDrain;

    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-a")).toBe(String(rewokenScore));

    const laterIngests: string[] = [];
    await runTick(laterIngests, recordedErrors);
    expect(laterIngests).toEqual(["cal-a"]);
    expect(await fakeRedis.zscore(PENDING_INGEST_KEY, "cal-a")).toBeNull();
    expect(recordedErrors).toEqual([]);
  });

  it("hands back a batch the drain threw away before reaching its ingest", async () => {
    const recordedErrors: unknown[] = [];
    const attemptedIngests: string[] = [];
    const blip = new Error("calendar lookup unavailable");

    const baseDependencies = await createDefaultDependencies();
    await expect(runDrainPendingIngest({
      ...baseDependencies,
      ...overrides((calendarIds) => {
        attemptedIngests.push(...calendarIds);
        return Promise.resolve({ affectedUserIds: [] });
      }),
      recordError: (error) => {
        recordedErrors.push(error);
      },
      resolveCalendars: () => Promise.reject(blip),
    })).rejects.toThrow("calendar lookup unavailable");
    expect(attemptedIngests).toEqual([]);

    const retryIngests: string[] = [];
    await runTick(retryIngests, recordedErrors);
    expect(retryIngests.toSorted()).toEqual(["cal-a", "cal-b", "cal-c"]);
    expect(recordedErrors).toEqual([]);
  });
});
