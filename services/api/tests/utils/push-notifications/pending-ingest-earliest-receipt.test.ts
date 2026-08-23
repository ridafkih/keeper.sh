import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_CORRELATION_KEY, PENDING_INGEST_KEY } from "@keeper.sh/calendar";
import type {
  createPushWebhookDependencies as createPushWebhookDependenciesFn,
} from "@/utils/push-notifications/pending-ingest";

const FIRST_WEBHOOK_AT = new Date("2026-08-12T00:00:00.000Z");
const SECOND_WEBHOOK_AT = new Date("2026-08-12T00:00:30.000Z");
const THIRD_WEBHOOK_AT = new Date("2026-08-12T00:02:00.000Z");
const CALENDAR_ID = "cal-1";
const ZADD_MODIFIERS = new Set(["CH", "GT", "INCR", "LT", "NX", "XX"]);
const SCORE_STRIDE = 2;

const zsets = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, string>>();

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

const splitZaddArguments = (
  args: (string | number)[],
): { modifiers: Set<string>; pairs: (string | number)[] } => {
  const modifiers = new Set<string>();
  let index = 0;
  while (index < args.length && ZADD_MODIFIERS.has(String(args[index]).toUpperCase())) {
    modifiers.add(String(args[index]).toUpperCase());
    index += 1;
  }
  return { modifiers, pairs: args.slice(index) };
};

const shouldWriteScore = (
  modifiers: Set<string>,
  scores: Map<string, number>,
  member: string,
  score: number,
): boolean => {
  const present = scores.has(member);
  if (!present) {
    return !modifiers.has("XX");
  }
  if (modifiers.has("NX")) {
    return false;
  }
  const current = scores.get(member) ?? score;
  if (modifiers.has("GT")) {
    return score > current;
  }
  if (modifiers.has("LT")) {
    return score < current;
  }
  return true;
};

const fakeRedis = {
  eval: (): Promise<unknown> => Promise.resolve([]),
  expire: (): Promise<number> => Promise.resolve(1),
  get: (): Promise<string | null> => Promise.resolve(null),
  hincrby: (key: string, field: string, by: number): Promise<number> => {
    const hash = readHash(key);
    const next = Number(hash.get(field) ?? 0) + by;
    hash.set(field, String(next));
    return Promise.resolve(next);
  },
  hset: (key: string, ...args: (string | number)[]): Promise<number> => {
    const hash = readHash(key);
    let added = 0;
    for (let index = 0; index < args.length; index += SCORE_STRIDE) {
      const field = String(args[index]);
      if (!hash.has(field)) {
        added += 1;
      }
      hash.set(field, String(args[index + 1]));
    }
    return Promise.resolve(added);
  },
  incr: (): Promise<number> => Promise.resolve(1),
  set: (): Promise<string | null> => Promise.resolve("OK"),
  zadd: (key: string, ...args: (string | number)[]): Promise<number> => {
    const scores = readZset(key);
    const { modifiers, pairs } = splitZaddArguments(args);
    let added = 0;
    for (let index = 0; index < pairs.length; index += SCORE_STRIDE) {
      const score = Number(pairs[index]);
      const member = String(pairs[index + 1]);
      if (shouldWriteScore(modifiers, scores, member, score)) {
        if (!scores.has(member)) {
          added += 1;
        }
        scores.set(member, score);
      }
    }
    return Promise.resolve(added);
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
    return Promise.resolve(String(scores.get(member)));
  },
};

vi.mock("@/context", () => ({
  database: {},
  env: { WEBHOOK_PUBLIC_URL: "https://www.example.com" },
  redis: fakeRedis,
  webhookConfig: null,
}));
vi.mock("@/env", () => ({ default: { WEBHOOK_PUBLIC_URL: "https://www.example.com" } }));
vi.mock("@/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

let createPushWebhookDependencies: typeof createPushWebhookDependenciesFn = () =>
  Promise.reject(new Error("Module not loaded"));

const markPendingAt = async (receivedAt: Date, correlationId: string): Promise<void> => {
  vi.setSystemTime(receivedAt);
  const dependencies = await createPushWebhookDependencies("google");
  await dependencies.markPendingIngest([CALENDAR_ID], correlationId);
};

const storedScore = async (): Promise<string | null> =>
  await fakeRedis.zscore(PENDING_INGEST_KEY, CALENDAR_ID);

beforeAll(async () => {
  vi.useFakeTimers();
  ({ createPushWebhookDependencies } = await import(
    "@/utils/push-notifications/pending-ingest"
  ));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  zsets.clear();
  hashes.clear();
});

describe("pending ingest receipt stamp", () => {
  it("keeps the first webhook's time when a second arrives while still pending", async () => {
    await markPendingAt(FIRST_WEBHOOK_AT, "correlation-a");
    await markPendingAt(SECOND_WEBHOOK_AT, "correlation-b");

    expect(await storedScore()).toBe(String(FIRST_WEBHOOK_AT.getTime()));
  });

  it("stamps the first webhook's time when nothing is pending yet", async () => {
    await markPendingAt(FIRST_WEBHOOK_AT, "correlation-a");

    expect(await storedScore()).toBe(String(FIRST_WEBHOOK_AT.getTime()));
    expect(readHash(PENDING_CORRELATION_KEY).get(CALENDAR_ID)).toBe("correlation-a");
  });

  it("uses the new webhook's time once the calendar has been drained", async () => {
    await markPendingAt(FIRST_WEBHOOK_AT, "correlation-a");
    await markPendingAt(SECOND_WEBHOOK_AT, "correlation-b");
    await fakeRedis.zrem(PENDING_INGEST_KEY, CALENDAR_ID);
    await markPendingAt(THIRD_WEBHOOK_AT, "correlation-c");

    expect(await storedScore()).toBe(String(THIRD_WEBHOOK_AT.getTime()));
  });
});
