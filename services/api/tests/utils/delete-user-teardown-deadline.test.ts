import { describe, expect, it, vi } from "vitest";

const TEARDOWN_BUDGET_MS = 9000;
const GUARD_MS = TEARDOWN_BUDGET_MS + 3000;

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

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

const loadTeardown = async () => {
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  vi.resetModules();
  vi.doMock("@/utils/logging", () => ({
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

  const { createDeleteUserSyncTeardown, TEARDOWN_QUEUE_CONNECTION_OPTIONS } = await import(
    "@/utils/delete-user-teardown"
  );

  return {
    createDeleteUserSyncTeardown,
    loggedErrors,
    loggedFields,
    prefixes: (): string[] => loggedErrors.map((entry) => String(entry.fields.prefix)),
    slugs: (): unknown[] => loggedErrors.map((entry) => entry.fields.slug),
    TEARDOWN_QUEUE_CONNECTION_OPTIONS,
  };
};

const neverSettles = (): Promise<number> => Promise.race<number>([]);

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
  listOAuthGrantProviders: () => Promise.resolve([]),
  listPushChannels: () => Promise.resolve([]),
  redis: { set: () => Promise.resolve("OK") },
});

describe("delete user teardown wall clock bound", () => {
  it("returns inside the request budget when a queue removal never settles", async () => {
    const { createDeleteUserSyncTeardown, prefixes, slugs } = await loadTeardown();
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
    const { createDeleteUserSyncTeardown } = await loadTeardown();
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
    const { createDeleteUserSyncTeardown, loggedErrors, prefixes, slugs } = await loadTeardown();
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
    const { TEARDOWN_QUEUE_CONNECTION_OPTIONS } = await loadTeardown();

    expect(typeof TEARDOWN_QUEUE_CONNECTION_OPTIONS.commandTimeout).toBe("number");
    expect(TEARDOWN_QUEUE_CONNECTION_OPTIONS.commandTimeout)
      .toBeLessThanOrEqual(TEARDOWN_BUDGET_MS);
    expect(TEARDOWN_QUEUE_CONNECTION_OPTIONS.maxRetriesPerRequest).not.toBeNull();
  });
});
