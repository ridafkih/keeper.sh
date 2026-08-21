import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ingestOAuthSources, FLEET_PASS_SOURCE_BOUND } from "../../src/jobs/ingest-sources";

const lockedCalendarIds: string[] = [];
const sharedRedisStore = new Map<string, string>();
const recordedAtByCalendarId = new Map<string, string>();

let ingestClock = 0;

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

const FLEET_SOURCE_COUNT = 1000;
const NEVER_INGESTED_COUNT = 100;
const CLOCK_ORIGIN_MS = Date.UTC(2026, 0, 1);
const MINUTE_MS = 60_000;

const buildCalendarId = (index: number): string => `calendar-${String(index).padStart(4, "0")}`;

const stampIngest = (calendarId: string): void => {
  ingestClock += 1;
  recordedAtByCalendarId.set(
    calendarId,
    new Date(CLOCK_ORIGIN_MS + ingestClock * MINUTE_MS).toISOString(),
  );
};

const resolveRecordedAt = (calendarId: string): string | null =>
  recordedAtByCalendarId.get(calendarId) ?? null;

interface FleetMember {
  calendarId: string;
  plan: string;
}

const buildOAuthSource = (member: FleetMember): Record<string, unknown> => ({
  accountId: `account-${member.calendarId}`,
  accessToken: "access-token",
  calendarId: member.calendarId,
  expiresAt: null,
  externalCalendarId: `external-${member.calendarId}`,
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: resolveRecordedAt(member.calendarId),
  ingestWindowStart: null,
  oauthCredentialId: `credential-${member.calendarId}`,
  plan: member.plan,
  provider: "google",
  reauthenticationSource: null,
  refreshToken: "refresh-token",
  syncToken: null,
  userId: `user-${member.calendarId}`,
});

const fleetMembers: FleetMember[] = [];

const seedFleet = (members: FleetMember[]): void => {
  fleetMembers.length = 0;
  fleetMembers.push(...members);
};

/* Physical row order is deliberately not the ordering under test. */
const shuffleIndex = (index: number): number => (index * 137 + 11) % FLEET_SOURCE_COUNT;

const buildUniformFleet = (plan: string): FleetMember[] =>
  Array.from({ length: FLEET_SOURCE_COUNT }, (_unused, index) => ({
    calendarId: buildCalendarId(shuffleIndex(index)),
    plan,
  }));

const buildMixedAgeFleet = (): FleetMember[] =>
  buildUniformFleet("free").map((member) => ({ ...member, plan: "free" }));

const dialect = new PgDialect();

interface OrderTerm {
  direction: number;
  expression: string;
  nullsFirst: boolean;
}

const stripNullsSuffix = (rendered: string): string => rendered.replace(/ nulls (first|last)$/, "");

const stripDirectionSuffix = (rendered: string): string => rendered.replace(/ (asc|desc)$/, "");

const resolveNullsFirst = (rendered: string, descending: boolean): boolean => {
  if (rendered.endsWith("nulls first")) {
    return true;
  }
  if (rendered.endsWith("nulls last")) {
    return false;
  }
  return descending;
};

const parseOrderTerm = (term: unknown): OrderTerm => {
  const rendered = dialect.sqlToQuery(term as SQL).sql.trim();
  const withoutNulls = stripNullsSuffix(rendered);
  const descending = withoutNulls.endsWith(" desc");
  const nullsFirst = resolveNullsFirst(rendered, descending);
  const expression = stripDirectionSuffix(withoutNulls);
  if (descending) {
    return { direction: -1, expression, nullsFirst };
  }
  return { direction: 1, expression, nullsFirst };
};

const resolveTermValue = (
  expression: string,
  row: Record<string, unknown>,
): string | number | null => {
  if (expression.includes("is null")) {
    if (row.ingestWindowRecordedAt === null) {
      return 1;
    }
    return 0;
  }
  if (expression.includes("'pro'")) {
    if (row.plan === "pro") {
      return 1;
    }
    return 0;
  }
  if (expression.includes("ingestWindowRecordedAt")) {
    const recordedAt = row.ingestWindowRecordedAt;
    if (recordedAt === null) {
      return null;
    }
    return String(recordedAt);
  }
  if (expression.includes(`"id"`)) {
    return String(row.calendarId);
  }
  throw new Error(`unmodelled ordering term: ${expression}`);
};

const compareDefined = (left: string | number, right: string | number): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const compareByTerm = (
  term: OrderTerm,
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
): number => {
  const leftValue = resolveTermValue(term.expression, leftRow);
  const rightValue = resolveTermValue(term.expression, rightRow);
  if (leftValue === null && rightValue === null) {
    return 0;
  }
  if (leftValue === null) {
    if (term.nullsFirst) {
      return -1;
    }
    return 1;
  }
  if (rightValue === null) {
    if (term.nullsFirst) {
      return 1;
    }
    return -1;
  }
  return compareDefined(leftValue, rightValue) * term.direction;
};

const applyOrdering = (
  rows: Record<string, unknown>[],
  ordering: unknown[],
): Record<string, unknown>[] => {
  if (ordering.length === 0) {
    return rows;
  }
  const terms = ordering.map((term) => parseOrderTerm(term));
  return rows.toSorted((leftRow, rightRow) => {
    for (const term of terms) {
      const outcome = compareByTerm(term, leftRow, rightRow);
      if (outcome !== 0) {
        return outcome;
      }
    }
    return 0;
  });
};

const resolveSourceRows = (projection: Record<string, unknown>): Record<string, unknown>[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return fleetMembers.map((member) => buildOAuthSource(member));
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
  ordering: unknown[];
}

const applyBounds = (
  rows: Record<string, unknown>[],
  bounds: QueryBounds,
): Record<string, unknown>[] => {
  const ordered = applyOrdering(rows, bounds.ordering);
  const { limit, offset } = bounds;
  if (limit === null) {
    return ordered.slice(offset);
  }
  return ordered.slice(offset, offset + limit);
};

const createBounds = (): QueryBounds => ({ limit: null, offset: 0, ordering: [] });

const createQuery = (resolve: () => Record<string, unknown>[], bounds: QueryBounds): unknown =>
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
        if (property === "orderBy") {
          bounds.ordering = args;
        }
        return createQuery(resolve, bounds);
      };
    },
  });

const fakeDatabase = {
  select: (projection: Record<string, unknown>) =>
    createQuery(() => resolveSelect(projection), createBounds()),
  transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
  update: () => createQuery(() => [], createBounds()),
};

const fakeRedis = {
  del: (...keys: string[]): Promise<number> => {
    for (const key of keys) {
      sharedRedisStore.delete(key);
    }
    return Promise.resolve(keys.length);
  },
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
      const calendarId = key.replaceAll("source-ingest:", "");
      lockedCalendarIds.push(calendarId);
      stampIngest(calendarId);
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
  FLEET_PASS_SOURCE_BOUND: typeof FLEET_PASS_SOURCE_BOUND;
  ingestOAuthSources: typeof ingestOAuthSources;
}

const startProcess = (): Promise<IngestSourcesModule> => {
  vi.resetModules();
  return import("../../src/jobs/ingest-sources");
};

const runPass = async (job: IngestSourcesModule): Promise<string[]> => {
  lockedCalendarIds.length = 0;
  await job.ingestOAuthSources();
  return [...lockedCalendarIds];
};

const PASS_COUNT = 6;

describe("the least recently ingested calendars are taken first", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    sharedRedisStore.clear();
    recordedAtByCalendarId.clear();
    ingestClock = 0;
    seedFleet(buildUniformFleet("free"));
  });

  it("visits every calendar once before it visits any calendar twice", async () => {
    const job = await startProcess();
    const visitOrder: string[] = [];

    for (let pass = 0; pass < PASS_COUNT; pass += 1) {
      const ingestedCalendarIds = await runPass(job);
      expect(ingestedCalendarIds.length).toBeLessThan(FLEET_SOURCE_COUNT);
      expect(ingestedCalendarIds.length).toBeGreaterThan(0);
      visitOrder.push(...ingestedCalendarIds);
    }

    const firstSweep = visitOrder.slice(0, FLEET_SOURCE_COUNT);
    expect(visitOrder.length).toBeGreaterThanOrEqual(FLEET_SOURCE_COUNT);
    expect(new Set(firstSweep).size).toBe(FLEET_SOURCE_COUNT);
  });

  it("sweeps the whole fleet with no state outside the rows", async () => {
    const visited = new Set<string>();

    for (let pass = 0; pass < PASS_COUNT; pass += 1) {
      sharedRedisStore.clear();
      const ingestedCalendarIds = await runPass(await startProcess());
      for (const calendarId of ingestedCalendarIds) {
        visited.add(calendarId);
      }
    }

    expect(visited.size).toBe(FLEET_SOURCE_COUNT);
  });

  it("puts a never-ingested calendar ahead of every already-ingested one", async () => {
    seedFleet(buildMixedAgeFleet());
    const job = await startProcess();
    const alreadyIngestedIds = fleetMembers
      .slice(0, FLEET_SOURCE_COUNT - NEVER_INGESTED_COUNT)
      .map((member) => member.calendarId);
    for (const calendarId of alreadyIngestedIds) {
      stampIngest(calendarId);
    }
    const neverIngestedIds = fleetMembers
      .filter((member) => !recordedAtByCalendarId.has(member.calendarId))
      .map((member) => member.calendarId);

    expect(neverIngestedIds).toHaveLength(NEVER_INGESTED_COUNT);

    const firstPassIds = new Set(await runPass(job));
    for (const calendarId of neverIngestedIds) {
      expect(firstPassIds.has(calendarId)).toBe(true);
    }

    const secondPassIds = new Set(await runPass(job));
    for (const calendarId of neverIngestedIds) {
      expect(secondPassIds.has(calendarId)).toBe(false);
    }
  });

  it("takes the bounded prefix of the fleet, not the whole fleet", async () => {
    const job = await startProcess();
    const ingestedCalendarIds = await runPass(job);

    expect(ingestedCalendarIds).toHaveLength(job.FLEET_PASS_SOURCE_BOUND);
  });
});
