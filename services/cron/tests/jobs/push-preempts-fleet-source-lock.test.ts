import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedAcquisition {
  factoryAcquisition: string;
  key: string;
  acquireArguments: unknown[];
}

const acquisitions: RecordedAcquisition[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    ENCRYPTION_KEY: "0".repeat(64),
    WORKER_JOB_QUEUE_ENABLED: false,
  },
}));

vi.mock("@/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(null),
}));

const OAUTH_SOURCE = {
  accountId: "account-1",
  accessToken: "access-token",
  calendarId: "calendar-1",
  expiresAt: null,
  externalCalendarId: "external-1",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: "credential-1",
  provider: "google",
  reauthenticationSource: null,
  refreshToken: "refresh-token",
  syncToken: null,
  userId: "user-1",
};

/*
 * The inner re-read carries no calendarId column, so an empty row there ends the
 * work as skipped once the lock has already been acquired — which is the only
 * step this suite observes.
 */
const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return [OAUTH_SOURCE];
  }
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  return [];
};

const createQuery = (resolve: () => unknown): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });

vi.mock("@/context", () => ({
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
    update: () => createQuery(() => []),
  },
  flushDatabase: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
    update: () => createQuery(() => []),
  },
  flushDrainRegistry: { register: (): null => null },
  refreshLockRedis: {},
  refreshLockStore: {},
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: (_redis: unknown, factoryAcquisition = "preempting") => ({
    acquire: (key: string, ...rest: unknown[]) => {
      acquisitions.push({ acquireArguments: rest, factoryAcquisition, key });
      return Promise.resolve({
        acquired: true,
        handle: {
          isCurrent: () => Promise.resolve(true),
          isHeld: () => Promise.resolve(true),
          release: () => Promise.resolve(null),
        },
      });
    },
  }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const { ingestOAuthSources } = ingestSourcesModule;

const SOURCE_LOCK_KEY = "source-ingest:calendar-1";

/*
 * The class may be fixed when the lock instance is built or passed at acquire
 * time; either way it is the acquisition the source lock ran under.
 */
const resolveAcquisitionClass = (acquisition: RecordedAcquisition): string => {
  const explicit = acquisition.acquireArguments.find(
    (argument): argument is string => argument === "background" || argument === "preempting",
  );
  return explicit ?? acquisition.factoryAcquisition;
};

const sourceLockClasses = (): string[] =>
  acquisitions
    .filter(({ key }) => key === SOURCE_LOCK_KEY)
    .map((acquisition) => resolveAcquisitionClass(acquisition));

describe("a webhook ingest supersedes a fleet ingest of the same calendar", () => {
  beforeEach(() => {
    acquisitions.length = 0;
  });

  it("takes the source lock as a preempting waiter on the push path", async () => {
    await ingestOAuthSources([OAUTH_SOURCE.calendarId]);

    expect(sourceLockClasses()).toEqual(["preempting"]);
  });

  it("keeps taking the source lock as a background waiter on the fleet path", async () => {
    await ingestOAuthSources();

    expect(sourceLockClasses()).toEqual(["background"]);
  });
});
