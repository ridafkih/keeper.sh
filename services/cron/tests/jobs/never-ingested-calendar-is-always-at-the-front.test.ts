import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ingestOAuthSources, FLEET_PASS_SOURCE_BOUND } from "../../src/jobs/ingest-sources";

const lockedCalendarIds: string[] = [];
const sharedRedisStore = new Map<string, string>();
const recordedAtByCalendarId = new Map<string, number>();

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

const CLOCK_ORIGIN_MS = Date.UTC(2026, 0, 1);
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const stampIngest = (calendarId: string): void => {
  ingestClock += 1;
  recordedAtByCalendarId.set(calendarId, CLOCK_ORIGIN_MS + ingestClock * MINUTE_MS);
};

const resolveRecordedAt = (calendarId: string): number | null =>
  recordedAtByCalendarId.get(calendarId) ?? null;

interface FleetMember {
  calendarId: string;
  plan: string;
}

interface FleetRow extends Record<string, unknown> {
  calendarId: string;
  ingestWindowRecordedAt: number | null;
  plan: string;
}

const buildOAuthSource = (member: FleetMember): FleetRow => ({
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

/*
 * The ordering under test is evaluated against the ORDER BY the job actually renders, so the
 * fixture's physical row order must never be the thing that decides the outcome.
 */
const dialect = new PgDialect();

const HEAD_START_PATTERN = /interval '(\d+) minutes'/;
const COALESCE_SENTINEL_PATTERN = /coalesce\([^,]*ingestWindowRecordedAt[^,]*,\s*'(-?infinity)'\)/;
const RECORDED_AT_COLUMN = "ingestWindowRecordedAt";

interface OrderTerm {
  direction: number;
  evaluate: (row: FleetRow) => number | string | null;
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
  /* Postgres default: nulls sort last ascending, first descending. */
  return descending;
};

const isProRow = (row: FleetRow): boolean => row.plan === "pro";

const resolveHeadStartMs = (expression: string): number => {
  const matched = HEAD_START_PATTERN.exec(expression);
  if (!matched?.[1]) {
    throw new Error(`head start not expressed in minutes: ${expression}`);
  }
  return Number(matched[1]) * MINUTE_MS;
};

/*
 * Read out of the rendered SQL rather than assumed: which sentinel a never-ingested calendar
 * coalesces to IS the behaviour under test, so hardcoding it here would let an inverted
 * ordering pass.
 */
const resolveNullSentinel = (expression: string): number => {
  const matched = COALESCE_SENTINEL_PATTERN.exec(expression);
  if (matched?.[1] === "-infinity") {
    return Number.NEGATIVE_INFINITY;
  }
  if (matched?.[1] === "infinity") {
    return Number.POSITIVE_INFINITY;
  }
  throw new Error(`never-ingested calendars have no infinity sentinel: ${expression}`);
};

/*
 * Models `coalesce(recorded_at, <sentinel>) - <head start>` the way Postgres evaluates it:
 * an infinite sentinel minus any finite interval is still infinite, so the plan advantage
 * cannot move a never-ingested calendar off whichever end the sentinel puts it on.
 */
const buildDiscountedRecencyTerm = (expression: string): OrderTerm["evaluate"] => {
  const headStartMs = resolveHeadStartMs(expression);
  const nullSentinel = resolveNullSentinel(expression);
  return (row: FleetRow): number => {
    const { ingestWindowRecordedAt } = row;
    if (ingestWindowRecordedAt === null) {
      return nullSentinel;
    }
    if (isProRow(row)) {
      return ingestWindowRecordedAt - headStartMs;
    }
    return ingestWindowRecordedAt;
  };
};

const buildNullFlagTerm = (): OrderTerm["evaluate"] =>
  (row: FleetRow): number => {
    if (row.ingestWindowRecordedAt === null) {
      return 1;
    }
    return 0;
  };

const buildRecencyTerm = (): OrderTerm["evaluate"] =>
  (row: FleetRow): number | null => row.ingestWindowRecordedAt;

const buildPlanTerm = (): OrderTerm["evaluate"] =>
  (row: FleetRow): number => {
    if (isProRow(row)) {
      return 1;
    }
    return 0;
  };

const buildIdTerm = (): OrderTerm["evaluate"] =>
  (row: FleetRow): string => row.calendarId;

const resolveEvaluator = (expression: string): OrderTerm["evaluate"] => {
  if (expression.includes(RECORDED_AT_COLUMN) && expression.includes("interval")) {
    return buildDiscountedRecencyTerm(expression);
  }
  if (expression.includes("is null")) {
    return buildNullFlagTerm();
  }
  if (expression.includes(RECORDED_AT_COLUMN)) {
    return buildRecencyTerm();
  }
  if (expression.includes("= 'pro'")) {
    return buildPlanTerm();
  }
  if (expression.includes(`"id"`)) {
    return buildIdTerm();
  }
  throw new Error(`unmodelled ordering term: ${expression}`);
};

const parseOrderTerm = (term: unknown): OrderTerm => {
  const rendered = dialect.sqlToQuery(term as SQL).sql.trim();
  const withoutNulls = stripNullsSuffix(rendered);
  const descending = withoutNulls.endsWith(" desc");
  const nullsFirst = resolveNullsFirst(rendered, descending);
  const expression = stripDirectionSuffix(withoutNulls);
  const evaluate = resolveEvaluator(expression);
  if (descending) {
    return { direction: -1, evaluate, nullsFirst };
  }
  return { direction: 1, evaluate, nullsFirst };
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

const compareByTerm = (term: OrderTerm, leftRow: FleetRow, rightRow: FleetRow): number => {
  const leftValue = term.evaluate(leftRow);
  const rightValue = term.evaluate(rightRow);
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

const applyOrdering = (rows: FleetRow[], ordering: unknown[]): FleetRow[] => {
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

const resolveSourceRows = (projection: Record<string, unknown>): FleetRow[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return fleetMembers.map((member) => buildOAuthSource(member));
  }
  return [];
};

const resolveSelect = (projection: Record<string, unknown>): FleetRow[] => {
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

const applyBounds = (rows: FleetRow[], bounds: QueryBounds): FleetRow[] => {
  const ordered = applyOrdering(rows, bounds.ordering);
  const { limit, offset } = bounds;
  if (limit === null) {
    return ordered.slice(offset);
  }
  return ordered.slice(offset, offset + limit);
};

const createBounds = (): QueryBounds => ({ limit: null, offset: 0, ordering: [] });

const createQuery = (resolve: () => FleetRow[], bounds: QueryBounds): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (
          onFulfilled: (value: unknown) => unknown,
          onRejected: (reason: unknown) => unknown,
        ) =>
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

const FLEET_SOURCE_COUNT = 400;
const NEVER_INGESTED_COUNT = 60;

const buildCalendarId = (index: number): string => `calendar-${String(index).padStart(4, "0")}`;

/* Physical row order is deliberately not the ordering under test. */
const shuffleIndex = (index: number): number => (index * 137 + 11) % FLEET_SOURCE_COUNT;

/*
 * Coprime with the never-ingested stride below, so both plans land on never-ingested and on
 * long-stale calendars alike.
 */
const alternatePlan = (index: number): string => {
  if (index % 7 < 3) {
    return "pro";
  }
  return "free";
};

/*
 * Never-ingested calendars are scattered through the fleet on both plans, and every other
 * calendar is stamped far in the past, so "never ingested" is the only thing that can put a
 * calendar at the front.
 */
const seedMixedAgeFleet = (): { neverIngested: FleetMember[]; stale: FleetMember[] } => {
  fleetMembers.length = 0;
  const neverIngested: FleetMember[] = [];
  const stale: FleetMember[] = [];
  for (let index = 0; index < FLEET_SOURCE_COUNT; index += 1) {
    const member: FleetMember = {
      calendarId: buildCalendarId(shuffleIndex(index)),
      plan: alternatePlan(index),
    };
    fleetMembers.push(member);
    /* Spread the never-ingested calendars across the fleet rather than clustering them. */
    if (index % 6 === 0 && neverIngested.length < NEVER_INGESTED_COUNT) {
      neverIngested.push(member);
    } else {
      stale.push(member);
    }
  }
  for (const [position, member] of stale.entries()) {
    recordedAtByCalendarId.set(member.calendarId, CLOCK_ORIGIN_MS - (position + 1) * DAY_MS);
  }
  return { neverIngested, stale };
};

describe("a never-ingested calendar is always at the front", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    sharedRedisStore.clear();
    recordedAtByCalendarId.clear();
    ingestClock = 0;
  });

  it("takes every never-ingested calendar before any calendar that has been ingested", async () => {
    const { neverIngested } = seedMixedAgeFleet();
    const job = await startProcess();

    expect(neverIngested).toHaveLength(NEVER_INGESTED_COUNT);
    expect(NEVER_INGESTED_COUNT).toBeLessThan(job.FLEET_PASS_SOURCE_BOUND);

    const takenCalendarIds = await runPass(job);
    const neverIngestedIds = new Set(neverIngested.map((member) => member.calendarId));
    const prefix = takenCalendarIds.slice(0, NEVER_INGESTED_COUNT);

    expect(new Set(prefix)).toEqual(neverIngestedIds);
  });

  it("keeps a never-ingested free calendar ahead of a pro calendar ingested long ago", async () => {
    const { neverIngested, stale } = seedMixedAgeFleet();
    const job = await startProcess();

    const freeNeverIngested = neverIngested.filter((member) => member.plan === "free");
    const proStale = stale.filter((member) => member.plan === "pro");

    expect(freeNeverIngested.length).toBeGreaterThan(0);
    expect(proStale.length).toBeGreaterThan(0);

    const takenCalendarIds = await runPass(job);
    const lastFreeNeverIngested = Math.max(
      ...freeNeverIngested.map((member) => takenCalendarIds.indexOf(member.calendarId)),
    );
    const firstProStale = Math.min(
      ...proStale.map((member) => takenCalendarIds.indexOf(member.calendarId))
        .filter((position) => position >= 0),
    );

    expect(lastFreeNeverIngested).toBeGreaterThanOrEqual(0);
    expect(lastFreeNeverIngested).toBeLessThan(firstProStale);
  });

  it("picks up a newly connected calendar on the very next pass", async () => {
    seedMixedAgeFleet();
    const job = await startProcess();

    await runPass(job);

    const newcomer: FleetMember = { calendarId: "calendar-newcomer", plan: "free" };
    fleetMembers.splice(Math.floor(FLEET_SOURCE_COUNT / 2), 0, newcomer);

    const nextPassIds = await runPass(job);

    expect(nextPassIds[0]).toBe(newcomer.calendarId);
  });
});
