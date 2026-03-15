import { describe, expect, it, beforeEach } from "bun:test";
import { checkAndIncrementApiUsage, FREE_DAILY_LIMIT } from "./api-rate-limit";

const createMockRedis = () => {
  const store = new Map<string, number>();
  const expiries = new Map<string, number>();

  return {
    store,
    expiries,
    incr: (key: string): Promise<number> => {
      const current = store.get(key) ?? 0;
      const next = current + 1;
      store.set(key, next);
      return Promise.resolve(next);
    },
    expire: (key: string, seconds: number): Promise<number> => {
      expiries.set(key, seconds);
      return Promise.resolve(1);
    },
  };
};

describe("checkAndIncrementApiUsage", () => {
  let mockRedis = createMockRedis();

  beforeEach(() => {
    mockRedis = createMockRedis();
  });

  it("allows pro users without checking redis", async () => {
    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "pro");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-1);
    expect(result.limit).toBe(-1);
    expect(mockRedis.store.size).toBe(0);
  });

  it("allows free users under the limit", async () => {
    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(FREE_DAILY_LIMIT - 1);
    expect(result.limit).toBe(FREE_DAILY_LIMIT);
  });

  it("sets expiry on first call", async () => {
    await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    const expiryKeys = [...mockRedis.expiries.keys()];
    expect(expiryKeys).toHaveLength(1);
    const firstKey = expiryKeys[0] as string;
    expect(mockRedis.expiries.get(firstKey)).toBe(86_400);
  });

  it("does not reset expiry on subsequent calls", async () => {
    await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    mockRedis.expiries.clear();

    await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    expect(mockRedis.expiries.size).toBe(0);
  });

  it("tracks remaining count correctly", async () => {
    for (let call = 0; call < 10; call++) {
      await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    }

    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(FREE_DAILY_LIMIT - 11);
  });

  it("blocks free users at the limit", async () => {
    for (let call = 0; call < FREE_DAILY_LIMIT; call++) {
      await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    }

    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(FREE_DAILY_LIMIT);
  });

  it("blocks free users over the limit", async () => {
    for (let call = 0; call < FREE_DAILY_LIMIT + 5; call++) {
      await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    }

    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("treats null plan as free", async () => {
    for (let call = 0; call < FREE_DAILY_LIMIT; call++) {
      await checkAndIncrementApiUsage(mockRedis as never, "user-1", null);
    }

    const result = await checkAndIncrementApiUsage(mockRedis as never, "user-1", null);

    expect(result.allowed).toBe(false);
  });

  it("tracks users independently", async () => {
    for (let call = 0; call < FREE_DAILY_LIMIT; call++) {
      await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    }

    const blockedResult = await checkAndIncrementApiUsage(mockRedis as never, "user-1", "free");
    const allowedResult = await checkAndIncrementApiUsage(mockRedis as never, "user-2", "free");

    expect(blockedResult.allowed).toBe(false);
    expect(allowedResult.allowed).toBe(true);
  });
});
