import { beforeEach, describe, expect, it, vi } from "vitest";

const TEARDOWN_BUDGET_MS = 9000;
const GUARD_MS = TEARDOWN_BUDGET_MS + 3000;

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

const loggedErrors: LoggedError[] = [];
const loggedFields: Record<string, unknown>[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: (prefix: string, error: unknown) => {
      loggedErrors.push({ error, fields: { prefix } });
    },
    errorFields: (error: unknown, fields: Record<string, unknown>) => {
      loggedErrors.push({ error, fields });
    },
    set: (key: string, value: unknown) => {
      loggedFields.push({ [key]: value });
    },
    setFields: (fields: Record<string, unknown>) => {
      loggedFields.push(fields);
    },
  },
}));

const queueOptions: unknown[] = [];

vi.mock("@keeper.sh/queue", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPushSyncQueue: (options: unknown) => {
    queueOptions.push(options);
    return { remove: () => Promise.resolve(0) };
  },
}));

vi.mock("@/context", () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "cal1" }, { id: "cal2" }]),
      }),
    }),
  },
  env: { REDIS_URL: "redis://localhost:6379" },
  redis: { set: () => Promise.resolve("OK") },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: null,
}));

const redis = { set: () => Promise.resolve("OK") };

const hangingResolvers: ((value: number) => void)[] = [];

const neverSettles = (): Promise<number> =>
  new Promise<number>((resolve) => {
    hangingResolvers.push(resolve);
  });

const raceWithGuard = async (work: Promise<void>): Promise<"guard" | "settled"> => {
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<"guard">((resolve) => {
    guardTimer = setTimeout(() => {
      resolve("guard");
    }, GUARD_MS);
  });

  const outcome = await Promise.race([work.then(() => "settled" as const), guard]);

  if (guardTimer !== null) {
    clearTimeout(guardTimer);
  }

  return outcome;
};

const makeDependencies = (remove: (jobId: string) => Promise<number>) => ({
  createQueue: () => ({ remove }),
  deregisterPushChannels: () => Promise.resolve(0),
  listCalendarIds: () => Promise.resolve(["cal1", "cal2"]),
  redis,
});

const slugs = (): unknown[] => loggedErrors.map((entry) => entry.fields.slug);

const prefixes = (): string[] => loggedErrors.map((entry) => String(entry.fields.prefix));

beforeEach(() => {
  loggedErrors.length = 0;
  loggedFields.length = 0;
  queueOptions.length = 0;
});

describe("delete user teardown wall clock bound", () => {
  it("returns inside the request budget when a queue removal never settles", async () => {
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const teardown = createDeleteUserSyncTeardown(makeDependencies(neverSettles) as never);

    const startedAt = Date.now();
    const outcome = await raceWithGuard(teardown("A"));
    const elapsedMs = Date.now() - startedAt;

    expect(outcome).toBe("settled");
    expect(elapsedMs).toBeLessThan(TEARDOWN_BUDGET_MS);
    expect(slugs()).toContain("delete-user-teardown-failed");
    expect(prefixes().some((prefix) => prefix.includes("sync_jobs"))).toBe(true);
  });

  it("still deregisters push channels after a stalled job drain", async () => {
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const deregisteredFor: string[] = [];
    const teardown = createDeleteUserSyncTeardown({
      ...makeDependencies(neverSettles),
      deregisterPushChannels: (userId: string) => {
        deregisteredFor.push(userId);
        return Promise.resolve(2);
      },
    } as never);

    const outcome = await raceWithGuard(teardown("A"));

    expect(outcome).toBe("settled");
    expect(deregisteredFor).toEqual(["A"]);
  });

  it("surfaces a rejected queue removal as a wide event error field", async () => {
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
    const teardown = createDeleteUserSyncTeardown(
      makeDependencies((jobId) =>
        new Promise<number>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error(`Command timed out for ${jobId}`));
          }, 50);
        })) as never,
    );

    await expect(teardown("A")).resolves.toBeUndefined();

    expect(slugs()).toContain("delete-user-teardown-failed");
    expect(prefixes().some((prefix) => prefix.includes("sync_jobs"))).toBe(true);
    expect(loggedErrors.some((entry) => String((entry.error as Error).message)
      .includes("Command timed out"))).toBe(true);
  });

  it("builds the teardown queue with bounded redis client options", async () => {
    const { deleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    await deleteUserSyncTeardown("A");

    const [options] = queueOptions as { commandTimeout?: unknown; maxRetriesPerRequest?: unknown }[];

    expect(options).toBeDefined();
    expect(typeof (options as { commandTimeout?: unknown }).commandTimeout).toBe("number");
    expect((options as { commandTimeout: number }).commandTimeout)
      .toBeLessThanOrEqual(TEARDOWN_BUDGET_MS);
    expect((options as { maxRetriesPerRequest?: unknown }).maxRetriesPerRequest)
      .not.toBeNull();
  });
});
