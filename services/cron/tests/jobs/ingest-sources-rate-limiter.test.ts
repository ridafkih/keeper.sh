import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface RateLimiterPermit {
  release(): Promise<void>;
}

interface FakeLimiter {
  acquire(count: number, signal?: AbortSignal): Promise<void>;
  acquirePermit?(signal?: AbortSignal): Promise<RateLimiterPermit>;
}

interface RateLimiterSourceContext {
  accountId: string;
  serverUrl: string;
  url: string;
  userId: string;
}

type ResolveRateLimiter = (
  provider: string,
  source: RateLimiterSourceContext,
) => FakeLimiter | undefined;

const factorySpies = vi.hoisted(() => ({
  caldavAccount: vi.fn((..._factoryArgs: unknown[]) => ({ acquire: () => Promise.resolve() })),
  google: vi.fn((..._factoryArgs: unknown[]) => ({ acquire: () => Promise.resolve() })),
  host: vi.fn((..._factoryArgs: unknown[]) => ({ acquire: () => Promise.resolve() })),
  outlookRelease: vi.fn((_lease: unknown) => Promise.resolve()),
  outlook: vi.fn((..._factoryArgs: unknown[]) => ({
    acquireLease: () => Promise.resolve({ key: "lease", token: "token" }),
    release: factorySpies.outlookRelease,
  })),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCalDAVAccountRateLimiter: factorySpies.caldavAccount,
    createGoogleUserRateLimiter: factorySpies.google,
    createHostRateLimiter: factorySpies.host,
    createOutlookAccountSemaphore: factorySpies.outlook,
  };
});

vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: { select: () => ({}), update: () => ({}) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
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
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

let resolveRateLimiter: ResolveRateLimiter = () => {
  throw new Error("Module not loaded");
};

const sourceContext: RateLimiterSourceContext = {
  accountId: "account-7",
  serverUrl: "https://caldav.example.com/dav/rida/",
  url: "https://feeds.example.net/team.ics",
  userId: "user-1",
};

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources") as unknown as Record<string, unknown>;
  expect(typeof module.resolveRateLimiter).toBe("function");
  resolveRateLimiter = module.resolveRateLimiter as ResolveRateLimiter;
});

beforeEach(() => {
  factorySpies.caldavAccount.mockClear();
  factorySpies.google.mockClear();
  factorySpies.host.mockClear();
  factorySpies.outlook.mockClear();
  factorySpies.outlookRelease.mockClear();
});

describe("resolveRateLimiter", () => {
  it("returns the per-user google limiter on the ingest lane", () => {
    const limiter = resolveRateLimiter("google", sourceContext);

    expect(limiter).toBeDefined();
    expect(typeof limiter?.acquire).toBe("function");
    expect(factorySpies.google).toHaveBeenCalledTimes(1);
    expect(factorySpies.google.mock.calls[0]?.[1]).toBe("user-1");
    expect(factorySpies.google.mock.calls[0]?.[2]).toBe("ingest");
  });

  it("returns a limiter-shaped adapter over the outlook semaphore keyed by accountId", () => {
    const limiter = resolveRateLimiter("outlook", sourceContext);

    expect(limiter).toBeDefined();
    expect(typeof limiter?.acquire).toBe("function");
    expect(factorySpies.outlook).toHaveBeenCalledTimes(1);
    expect(factorySpies.outlook.mock.calls[0]?.[1]).toBe("account-7");
  });

  it("returns a host limiter keyed by the caldav credential server host", () => {
    const limiter = resolveRateLimiter("caldav", sourceContext);

    expect(limiter).toBeDefined();
    expect(typeof limiter?.acquire).toBe("function");
    expect(factorySpies.host).toHaveBeenCalledTimes(1);
    expect(factorySpies.host.mock.calls[0]?.[1]).toBe("caldav.example.com");
  });

  it("keys the hosted caldav variants by account so customers never share a budget", () => {
    for (const provider of ["fastmail", "icloud"]) {
      const limiter = resolveRateLimiter(provider, sourceContext);

      expect(limiter).toBeDefined();
      expect(typeof limiter?.acquire).toBe("function");
    }
    expect(factorySpies.caldavAccount).toHaveBeenCalledTimes(2);
    expect(factorySpies.caldavAccount.mock.calls[0]?.[1]).toBe("account-7");
    expect(factorySpies.host).not.toHaveBeenCalled();
  });

  it("keeps a self-hosted caldav server on its host budget, which is what protects it", () => {
    const limiter = resolveRateLimiter("caldav", sourceContext);

    expect(limiter).toBeDefined();
    expect(factorySpies.host).toHaveBeenCalledTimes(1);
    expect(factorySpies.host.mock.calls[0]?.[1]).toBe("caldav.example.com");
    expect(factorySpies.caldavAccount).not.toHaveBeenCalled();
  });

  it("falls back to the host budget when a hosted source has no account to key on", () => {
    const limiter = resolveRateLimiter("icloud", { ...sourceContext, accountId: "" });

    expect(limiter).toBeDefined();
    expect(factorySpies.host).toHaveBeenCalledTimes(1);
    expect(factorySpies.caldavAccount).not.toHaveBeenCalled();
  });

  it("returns a host limiter keyed by the ics feed host", () => {
    const limiter = resolveRateLimiter("ical", sourceContext);

    expect(limiter).toBeDefined();
    expect(typeof limiter?.acquire).toBe("function");
    expect(factorySpies.host).toHaveBeenCalledTimes(1);
    expect(factorySpies.host.mock.calls[0]?.[1]).toBe("feeds.example.net");
  });

  /*
   * The permit is request-scoped, so the lease a request took is handed back when that
   * request settles rather than being held for the whole run.
   */
  it("releases the outlook lease when the request that took it completes", async () => {
    const limiter = resolveRateLimiter("outlook", sourceContext);

    const permit = await limiter?.acquirePermit?.();
    await permit?.release();

    expect(factorySpies.outlookRelease).toHaveBeenCalledTimes(1);
    expect(factorySpies.outlookRelease.mock.calls[0]?.[0]).toEqual({ key: "lease", token: "token" });
  });

  it("an unreleased permit leaves the lease to its ttl", async () => {
    const limiter = resolveRateLimiter("outlook", sourceContext);

    await limiter?.acquire(1);

    expect(factorySpies.outlookRelease).not.toHaveBeenCalled();
  });

  it("returns no limiter for an unrecognised provider", () => {
    const limiter = resolveRateLimiter("exchange-ews", sourceContext);

    expect(limiter).toBeUndefined();
    expect(factorySpies.google).not.toHaveBeenCalled();
    expect(factorySpies.host).not.toHaveBeenCalled();
    expect(factorySpies.outlook).not.toHaveBeenCalled();
  });
});
