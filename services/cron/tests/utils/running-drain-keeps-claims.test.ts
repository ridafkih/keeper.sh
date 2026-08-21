import { beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_REWAKE_KEY } from "@keeper.sh/calendar";
import type {
  DrainPendingIngestDependencies,
  ResolvedPendingCalendar,
} from "../../src/utils/drain-pending-ingest";

const CLAIM_LIMIT = 50;
const RELEASE_KEY_COUNT = 4;
const SCORE_STRIDE = 3;

const correlationError = new Error("correlation read failed");

const zsets = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();

const state = {
  correlationFails: false,
  deletedKeys: [] as string[],
};

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

const resolveBound = (bound: number, length: number): number => {
  if (bound < 0) {
    return length + bound;
  }
  return bound;
};

const fakeRedis = {
  del: (...keys: string[]): Promise<number> => {
    state.deletedKeys.push(...keys);
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
    if (numKeys !== RELEASE_KEY_COUNT || argv.length % SCORE_STRIDE !== 0) {
      throw new Error(
        `Fake redis cannot evaluate a script of ${numKeys} keys and ${argv.length} args`,
      );
    }
    const scores = readZset(keys[0] ?? "");
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
  hincrby: (key: string, field: string, by: number): Promise<number> => {
    const next = Number(readHash(key).get(field) ?? 0) + by;
    readHash(key).set(field, String(next));
    return Promise.resolve(next);
  },
  hmget: (key: string, ...fields: string[]): Promise<(string | null)[]> => {
    if (state.correlationFails) {
      return Promise.reject(correlationError);
    }
    return Promise.resolve(fields.map((field) => readHash(key).get(field) ?? null));
  },
  hsetnx: (key: string, field: string, value: string): Promise<number> => {
    const hash = readHash(key);
    if (hash.has(field)) {
      return Promise.resolve(0);
    }
    hash.set(field, value);
    return Promise.resolve(1);
  },
  set: (
    key: string,
    value: string,
    ...options: (string | number)[]
  ): Promise<string | null> => {
    const wantsNx = options.map(String).some((option) => option.toUpperCase() === "NX");
    if (wantsNx && strings.has(key)) {
      return Promise.resolve(null);
    }
    strings.set(key, value);
    return Promise.resolve("OK");
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

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: "test-key", WEBHOOK_PUBLIC_URL: "https://www.example.com" },
}));
vi.mock("../../src/context", () => ({
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: fakeRedis,
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
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
const { buildClaimKey } = await import("../../src/utils/pending-ingest-claim");
const { runDrainPendingIngest } = await import("../../src/utils/drain-pending-ingest");
const { createDefaultDependencies } = await import("../../src/jobs/drain-pending-ingest");
const { createScopedClaimPending } = await import("../../src/utils/scoped-drain-pending-ingest");
const { createInFlightDrainRegistry } = await import("../../src/utils/in-flight-drains");

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

const flushMacrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

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
  observe: () => null,
  resolveCalendars,
  resolvePlan: () => Promise.resolve("pro"),
});

beforeEach(() => {
  zsets.clear();
  hashes.clear();
  strings.clear();
  state.correlationFails = false;
  state.deletedKeys = [] as string[];
  wakePending("cal-a", 1000);
  wakePending("cal-b", 2000);
  wakePending("cal-c", 3000);
});

describe("a running drain keeps its claims", () => {
  it("keeps the in-flight claim when another claimer releases its own failed reservations", async () => {
    const signalledIngests: string[] = [];
    const tickIngests: string[] = [];
    const recordedErrors: unknown[] = [];
    const ingestEntered = createDeferred();
    const ingestHeld = createDeferred();

    const baseDependencies = await createDefaultDependencies();
    const recordError = (error: unknown): void => {
      recordedErrors.push(error);
    };

    const signalledDrain = runDrainPendingIngest({
      ...baseDependencies,
      ...overrides(async (calendarIds) => {
        signalledIngests.push(...calendarIds);
        ingestEntered.settle();
        await ingestHeld.promise;
        return { affectedUserIds: [] };
      }),
      claimPending: createScopedClaimPending(fakeRedis, ["cal-a"]),
      recordError,
    });

    await ingestEntered.promise;
    expect(strings.has(buildClaimKey("cal-a"))).toBe(true);

    state.correlationFails = true;
    const { claimPending } = await createDefaultDependencies();
    await expect(claimPending(CLAIM_LIMIT)).rejects.toBe(correlationError);
    state.correlationFails = false;

    expect(state.deletedKeys.toSorted()).toEqual(
      [buildClaimKey("cal-b"), buildClaimKey("cal-c")].toSorted(),
    );
    expect(strings.has(buildClaimKey("cal-a"))).toBe(true);

    await runDrainPendingIngest({
      ...baseDependencies,
      ...overrides((calendarIds) => {
        tickIngests.push(...calendarIds);
        return Promise.resolve({ affectedUserIds: [] });
      }),
      recordError,
    });

    expect(tickIngests.toSorted()).toEqual(["cal-b", "cal-c"]);
    expect(strings.has(buildClaimKey("cal-a"))).toBe(true);

    ingestHeld.settle();
    await signalledDrain;

    expect(signalledIngests).toEqual(["cal-a"]);
    expect(recordedErrors).toEqual([] as unknown[]);
  });

  it("keeps the in-flight claim while shutdown waits on the drain registry", async () => {
    const signalledIngests: string[] = [];
    const tickIngests: string[] = [];
    const ingestEntered = createDeferred();
    const ingestHeld = createDeferred();
    const events: string[] = [];

    const baseDependencies = await createDefaultDependencies();
    const registry = createInFlightDrainRegistry();

    const signalledDrain = runDrainPendingIngest({
      ...baseDependencies,
      ...overrides(async (calendarIds) => {
        signalledIngests.push(...calendarIds);
        ingestEntered.settle();
        await ingestHeld.promise;
        return { affectedUserIds: [] };
      }),
      claimPending: createScopedClaimPending(fakeRedis, ["cal-a"]),
      recordError: () => null,
    });
    registry.register(signalledDrain.then(() => {
      events.push("drain-finished");
      return null;
    }));

    await ingestEntered.promise;

    const settled = registry.settle().then(() => {
      events.push("registry-settled");
      return null;
    });
    await flushMacrotask();

    expect(events).toEqual([] as string[]);
    expect(strings.has(buildClaimKey("cal-a"))).toBe(true);

    await runDrainPendingIngest({
      ...baseDependencies,
      ...overrides((calendarIds) => {
        tickIngests.push(...calendarIds);
        return Promise.resolve({ affectedUserIds: [] });
      }),
      recordError: () => null,
    });

    expect(tickIngests.toSorted()).toEqual(["cal-b", "cal-c"]);
    expect(strings.has(buildClaimKey("cal-a"))).toBe(true);

    ingestHeld.settle();
    await signalledDrain;
    await settled;

    expect(events).toEqual(["drain-finished", "registry-settled"]);
    expect(strings.has(buildClaimKey("cal-a"))).toBe(false);
  });
});
