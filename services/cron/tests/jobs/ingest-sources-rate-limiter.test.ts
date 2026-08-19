import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeLimiter {
  acquire(count: number, signal?: AbortSignal): Promise<void>;
  dispose?(): Promise<void>;
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
    createGoogleUserRateLimiter: factorySpies.google,
    createHostRateLimiter: factorySpies.host,
    createOutlookAccountSemaphore: factorySpies.outlook,
  };
});

vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => ({
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

  // CalDAV sources are stored as 'caldav', 'fastmail', or 'icloud', so all three need the host budget.
  it("keys the branded caldav variants by server host like plain caldav", () => {
    for (const provider of ["fastmail", "icloud"]) {
      const limiter = resolveRateLimiter(provider, sourceContext);

      expect(limiter).toBeDefined();
      expect(typeof limiter?.acquire).toBe("function");
    }
    expect(factorySpies.host).toHaveBeenCalledTimes(2);
    expect(factorySpies.host.mock.calls[0]?.[1]).toBe("caldav.example.com");
    expect(factorySpies.host.mock.calls[1]?.[1]).toBe("caldav.example.com");
  });

  it("returns a host limiter keyed by the ics feed host", () => {
    const limiter = resolveRateLimiter("ical", sourceContext);

    expect(limiter).toBeDefined();
    expect(typeof limiter?.acquire).toBe("function");
    expect(factorySpies.host).toHaveBeenCalledTimes(1);
    expect(factorySpies.host.mock.calls[0]?.[1]).toBe("feeds.example.net");
  });

  /*
   * The lease's 150s TTL outlives a source's own 120s ingest deadline, so a
   * lease left to expire would strand an account's next calendar in the pass.
   */
  it("releases the outlook lease on dispose", async () => {
    const limiter = resolveRateLimiter("outlook", sourceContext);

    await limiter?.acquire(1);
    await limiter?.dispose?.();

    expect(factorySpies.outlookRelease).toHaveBeenCalledTimes(1);
    expect(factorySpies.outlookRelease.mock.calls[0]?.[0]).toEqual({ key: "lease", token: "token" });
  });

  it("dispose without a prior acquire releases nothing", async () => {
    const limiter = resolveRateLimiter("outlook", sourceContext);

    await limiter?.dispose?.();

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
