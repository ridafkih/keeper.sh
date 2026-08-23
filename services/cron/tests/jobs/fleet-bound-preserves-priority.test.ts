import { beforeEach, describe, expect, it, vi } from "vitest";
import { asc, desc, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { calendarsTable, userSubscriptionsTable } from "@keeper.sh/database/schema";
import type { ingestOAuthSources } from "../../src/jobs/ingest-sources";

const lockedCalendarIds: string[] = [];
const capturedOrderings: unknown[][] = [];
const sharedRedisStore = new Map<string, string>();

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
    setFields: () => null,
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

const NEVER_INGESTED_PRO_COUNT = 150;
const NEVER_INGESTED_FREE_COUNT = 150;
const INGESTED_PRO_COUNT = 50;
const INGESTED_FREE_COUNT = 50;
const FLEET_SOURCE_COUNT =
  NEVER_INGESTED_PRO_COUNT
  + NEVER_INGESTED_FREE_COUNT
  + INGESTED_PRO_COUNT
  + INGESTED_FREE_COUNT;

interface SourceTier {
  neverIngested: boolean;
  pro: boolean;
  rank: number;
}

const TIERS: SourceTier[] = [
  { neverIngested: true, pro: true, rank: 0 },
  { neverIngested: true, pro: false, rank: 1 },
  { neverIngested: false, pro: true, rank: 2 },
  { neverIngested: false, pro: false, rank: 3 },
];

const TIER_COUNTS = [
  NEVER_INGESTED_PRO_COUNT,
  NEVER_INGESTED_FREE_COUNT,
  INGESTED_PRO_COUNT,
  INGESTED_FREE_COUNT,
];

const buildCalendarId = (index: number): string => `calendar-${String(index).padStart(4, "0")}`;

const resolveIngestWindowRecordedAt = (tier: SourceTier): string | null => {
  if (tier.neverIngested) {
    return null;
  }
  return "2026-08-01T00:00:00.000Z";
};

const resolvePlan = (tier: SourceTier): string => {
  if (tier.pro) {
    return "pro";
  }
  return "free";
};

const buildOAuthSource = (calendarId: string, tier: SourceTier): Record<string, unknown> => ({
  accountId: `account-${calendarId}`,
  accessToken: "access-token",
  calendarId,
  expiresAt: null,
  externalCalendarId: `external-${calendarId}`,
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: resolveIngestWindowRecordedAt(tier),
  ingestWindowStart: null,
  oauthCredentialId: `credential-${calendarId}`,
  plan: resolvePlan(tier),
  priorityRank: tier.rank,
  provider: "google",
  reauthenticationSource: null,
  refreshToken: "refresh-token",
  syncToken: null,
  userId: `user-${calendarId}`,
});

const buildFleetSources = (): Record<string, unknown>[] => {
  const sources: Record<string, unknown>[] = [];
  const remaining = [...TIER_COUNTS];
  let index = 0;
  while (sources.length < FLEET_SOURCE_COUNT) {
    for (const [tierIndex, tier] of TIERS.entries()) {
      const left = remaining[tierIndex] ?? 0;
      if (left > 0) {
        sources.push(buildOAuthSource(buildCalendarId(index), tier));
        remaining[tierIndex] = left - 1;
        index += 1;
      }
    }
  }
  return sources;
};

const FLEET_SOURCES = buildFleetSources();
const FLEET_CALENDAR_IDS = FLEET_SOURCES.map((source) => String(source.calendarId));

const rankOf = (calendarId: string): number => {
  const source = FLEET_SOURCES.find((row) => row.calendarId === calendarId);
  return Number(source?.priorityRank);
};

const idsOfRank = (rank: number): string[] =>
  FLEET_SOURCES.filter((source) => source.priorityRank === rank).map((source) =>
    String(source.calendarId),
  );

const prioritise = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
  rows.toSorted((left, right) => Number(left.priorityRank) - Number(right.priorityRank));

const resolveSourceRows = (projection: Record<string, unknown>): Record<string, unknown>[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return prioritise(FLEET_SOURCES);
  }
  return [];
};

const resolveSelect = (projection: Record<string, unknown>): Record<string, unknown>[] => {
  const rows = resolveSourceRows(projection);
  if (!("failureCount" in projection)) {
    return rows;
  }
  return rows.map((row) => ({ ...row, failureCount: 0, nextAttemptAt: null }));
};

interface QueryBounds {
  limit: number | null;
  offset: number;
}

const applyBounds = (
  rows: Record<string, unknown>[],
  bounds: QueryBounds,
): Record<string, unknown>[] => {
  const { limit, offset } = bounds;
  if (limit === null) {
    return rows.slice(offset);
  }
  return rows.slice(offset, offset + limit);
};

const createQuery = (
  resolve: () => Record<string, unknown>[],
  bounds: QueryBounds,
  tracked: boolean,
): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => applyBounds(resolve(), bounds))
            .then(onFulfilled)
            .catch(onRejected);
      }
      return (...args: unknown[]) => {
        if (property === "limit") {
          bounds.limit = Number(args[0]);
        }
        if (property === "offset") {
          bounds.offset = Number(args[0]);
        }
        if (property === "orderBy" && tracked) {
          capturedOrderings.push(args);
        }
        return createQuery(resolve, bounds, tracked);
      };
    },
  });

const fakeDatabase = {
  select: (projection: Record<string, unknown>) =>
    createQuery(
      () => resolveSelect(projection),
      { limit: null, offset: 0 },
      "oauthCredentialId" in projection && "calendarId" in projection,
    ),
  transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
  update: () => createQuery(() => [], { limit: null, offset: 0 }, false),
};

const fakeRedis = {
  eval: (): Promise<null> => Promise.resolve(null),
  get: (key: string): Promise<string | null> =>
    Promise.resolve(sharedRedisStore.get(key) ?? null),
  set: (key: string, value: string): Promise<string> => {
    sharedRedisStore.set(key, value);
    return Promise.resolve("OK");
  },
  zmscore: (_key: string, ...calendarIds: string[]): Promise<(string | null)[]> =>
    Promise.resolve(calendarIds.map(() => null)),
};

vi.mock("@/context", () => ({
  database: fakeDatabase,
  flushDatabase: fakeDatabase,
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: fakeRedis,
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: (key: string) => {
      lockedCalendarIds.push(key.replaceAll("source-ingest:", ""));
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

interface IngestSourcesModule {
  ingestOAuthSources: typeof ingestOAuthSources;
}

const startProcess = (): Promise<IngestSourcesModule> => {
  vi.resetModules();
  return import("../../src/jobs/ingest-sources");
};

const runPass = async (
  job: IngestSourcesModule,
  calendarIds?: string[],
): Promise<string[]> => {
  lockedCalendarIds.length = 0;
  await job.ingestOAuthSources(calendarIds);
  return [...lockedCalendarIds];
};

const PRIORITY_ORDERING = [
  sql`coalesce(${calendarsTable.ingestWindowRecordedAt}, '-infinity') - case when coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro' then interval '10 minutes' else interval '0' end asc`,
  sql`${calendarsTable.ingestWindowRecordedAt} asc nulls first`,
  desc(sql`coalesce(${userSubscriptionsTable.plan}, 'free') = 'pro'`),
  asc(calendarsTable.id),
];

const renderOrdering = (orderings: unknown[]): string[] => {
  const dialect = new PgDialect();
  return orderings.map(
    (ordering) => dialect.sqlToQuery(ordering as Parameters<PgDialect["sqlToQuery"]>[0]).sql,
  );
};

describe("the bound keeps the prioritised head and leaves the webhook path alone", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    capturedOrderings.length = 0;
    sharedRedisStore.clear();
  });

  it("asks the database for never-ingested first, then pro, before bounding", async () => {
    await runPass(await startProcess());

    expect(capturedOrderings).toHaveLength(1);
    expect(renderOrdering(capturedOrderings[0] ?? [])).toEqual(renderOrdering(PRIORITY_ORDERING));
  });

  it("spends its bounded budget on the highest-priority sources", async () => {
    const ingestedCalendarIds = await runPass(await startProcess());

    expect(ingestedCalendarIds.length).toBeGreaterThan(0);
    expect(ingestedCalendarIds.length).toBeLessThan(FLEET_SOURCE_COUNT);

    const ingested = new Set(ingestedCalendarIds);
    const deferredRanks = FLEET_CALENDAR_IDS.filter((calendarId) => !ingested.has(calendarId)).map(
      (calendarId) => rankOf(calendarId),
    );
    const worstIngestedRank = Math.max(...ingestedCalendarIds.map((id) => rankOf(id)));

    expect(Math.min(...deferredRanks)).toBeGreaterThanOrEqual(worstIngestedRank);
  });

  it("never leaves a never-ingested calendar behind for an already-ingested one", async () => {
    const ingested = new Set(await runPass(await startProcess()));

    for (const calendarId of idsOfRank(0)) {
      expect(ingested.has(calendarId)).toBe(true);
    }
    for (const calendarId of [...idsOfRank(2), ...idsOfRank(3)]) {
      expect(ingested.has(calendarId)).toBe(false);
    }
  });

  it("ingests every id the webhook path names, past any fleet bound", async () => {
    const ingestedCalendarIds = await runPass(await startProcess(), FLEET_CALENDAR_IDS);

    expect(new Set(ingestedCalendarIds)).toEqual(new Set(FLEET_CALENDAR_IDS));
    expect(ingestedCalendarIds).toHaveLength(FLEET_SOURCE_COUNT);
  });

  it("ingests every named id even after a fleet pass has carried a remainder", async () => {
    const job = await startProcess();

    await runPass(job);
    const ingestedCalendarIds = await runPass(job, FLEET_CALENDAR_IDS);

    expect(ingestedCalendarIds).toHaveLength(FLEET_SOURCE_COUNT);
    expect(new Set(ingestedCalendarIds)).toEqual(new Set(FLEET_CALENDAR_IDS));
  });

  it("does not let a webhook call move where the next fleet pass resumes", async () => {
    const job = await startProcess();

    await runPass(job);
    const controlPassCalendarIds = await runPass(job);

    sharedRedisStore.clear();
    await runPass(job);
    await runPass(job, FLEET_CALENDAR_IDS.slice(0, INGESTED_FREE_COUNT));
    const observedPassCalendarIds = await runPass(job);

    expect(observedPassCalendarIds).toEqual(controlPassCalendarIds);
  });
});
