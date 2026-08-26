import { describe, expect, it, vi } from "vitest";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

interface WideEventCapture {
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
}

vi.mock("widelogger", () => {
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  return {
    startWideEventCapture: (): WideEventCapture => {
      loggedErrors.length = 0;
      loggedFields.length = 0;
      return { loggedErrors, loggedFields };
    },
    widelog: {
      error: (prefix: string, error: unknown) => {
        loggedErrors.push({ error, fields: { prefix } });
      },
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        loggedErrors.push({ error, fields });
      },
      errors: () => undefined,
      flush: () => undefined,
      set: (key: string, value: unknown) => {
        loggedFields.push({ [key]: value });
      },
      setFields: (fields: Record<string, unknown>) => {
        loggedFields.push(fields);
      },
    },
    widelogger: () => ({
      context: (run: () => unknown) => run(),
      destroy: () => Promise.resolve(),
    }),
  };
});

const startWideEventCapture = async (): Promise<WideEventCapture> => {
  const logging = (await import("widelogger")) as unknown as {
    startWideEventCapture: () => WideEventCapture;
  };

  return logging.startWideEventCapture();
};

const ROLLED_BACK_USER = "user-whose-delete-failed";

const createRedisHarness = () => {
  const keys = new Map<string, string>();

  return {
    has: (key: string) => keys.has(key),
    redis: {
      del: (key: string) => Promise.resolve(keys.delete(key) ? 1 : 0),
      exists: (key: string) => Promise.resolve(keys.has(key) ? 1 : 0),
      set: (key: string, value: string) => {
        keys.set(key, value);
        return Promise.resolve("OK");
      },
    },
  };
};

const createResidueStoreWithoutDeleteForUser = () => {
  const recorded: { kind: string; userId: string }[] = [];

  return {
    recorded,
    store: {
      clear: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      record: (draft: { kind: string; userId: string }) => {
        recorded.push({ kind: draft.kind, userId: draft.userId });
        return Promise.resolve();
      },
    },
  };
};

describe("a rollback whose residue store cannot delete residue fails loudly", () => {
  it("rejects naming the user and the residue left behind instead of resolving quietly", async () => {
    await startWideEventCapture();

    const { createDeleteUserSyncTeardownRollback } = await import("@/utils/delete-user-teardown");

    const redis = createRedisHarness();
    const residue = createResidueStoreWithoutDeleteForUser();

    const rollback = createDeleteUserSyncTeardownRollback({
      redis: redis.redis,
      residue: residue.store,
    } as never);

    const outcome = await rollback(ROLLED_BACK_USER).then(
      () => ({ rejected: false as const }),
      (error: unknown) => ({ error, rejected: true as const }),
    );

    expect(outcome.rejected).toBe(true);

    const message = outcome.rejected ? String((outcome.error as Error).message) : "";

    expect(message).toContain(ROLLED_BACK_USER);
    expect(message.toLowerCase()).toContain("residue");
  });
});
