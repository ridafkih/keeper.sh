import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { sql } from "drizzle-orm";
import { recordSyncFailure, recordSyncRun } from "../src/sync-run-recording";
import type { SyncRunRecordingInput } from "../src/sync-run-recording";

const ADMIN_DATABASE_URL = Bun.env.MIGRATION_TEST_DATABASE_URL;
const DATABASE_PACKAGE_ROOT = `${import.meta.dirname}/../../database`;
const DATABASE_NAME = `keeper_sync_recording_${process.pid}_${Date.now()}`;
const SETUP_TIMEOUT_MS = 180_000;

type DatabaseInstance = Awaited<ReturnType<typeof createDatabase>>;

interface Fixture {
  family: string;
  school: string;
  schoolSync: string;
  work: string;
  workSync: string;
}

const withAdmin = async (run: (admin: SQL) => Promise<unknown>): Promise<void> => {
  const admin = new SQL(ADMIN_DATABASE_URL ?? "");
  try {
    await run(admin);
  } finally {
    await admin.close();
  }
};

const databaseUrl = (): string => {
  const url = new URL(ADMIN_DATABASE_URL ?? "postgres://localhost");
  url.pathname = `/${DATABASE_NAME}`;
  return url.toString();
};

const migrate = async (): Promise<void> => {
  const runner = Bun.spawn(["bun", "scripts/migrate.ts"], {
    cwd: DATABASE_PACKAGE_ROOT,
    env: { ...Bun.env, DATABASE_URL: databaseUrl() },
    stderr: "pipe",
    stdout: "pipe",
  });
  if (await runner.exited !== 0) {
    throw new Error(`Migration failed: ${await new Response(runner.stderr).text()}`);
  }
};

const rows = async <TRow>(database: DatabaseInstance, query: ReturnType<typeof sql>): Promise<TRow[]> =>
  [...await database.execute(query)] as TRow[];

const insertReturningId = async (database: DatabaseInstance, query: ReturnType<typeof sql>): Promise<string> => {
  const [row] = await rows<{ id: string }>(database, query);
  if (!row) {
    throw new Error("Insert returned nothing");
  }
  return row.id;
};

const seed = async (database: DatabaseInstance): Promise<Fixture> => {
  const userId = `user-${crypto.randomUUID()}`;
  await database.execute(sql`INSERT INTO "user" ("id", "email", "name") VALUES (${userId}, ${`${userId}@example.com`}, 'Fixture')`);
  const accountId = await insertReturningId(database, sql`
    INSERT INTO "calendar_accounts" ("authType", "provider", "userId") VALUES ('oauth', 'google', ${userId}) RETURNING "id"
  `);
  const calendar = (name: string) => insertReturningId(database, sql`
    INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
    VALUES (${accountId}, 'google', ${name}, ${userId}) RETURNING "id"
  `);
  const sync = (name: string) => insertReturningId(database, sql`
    INSERT INTO "syncs" ("name", "userId") VALUES (${name}, ${userId}) RETURNING "id"
  `);
  const fixture = {
    family: await calendar("Family"),
    school: await calendar("School"),
    schoolSync: await sync("School to Family"),
    work: await calendar("Work"),
    workSync: await sync("Work to Family"),
  };
  await database.execute(sql`
    INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId", "syncId")
    VALUES (${fixture.work}, ${fixture.family}, ${fixture.workSync}),
           (${fixture.school}, ${fixture.family}, ${fixture.schoolSync})
  `);
  return fixture;
};

const NO_TALLY = { added: 0, failed: 0, removed: 0, updated: 0 };

const runInput = (fixture: Fixture, overrides: Partial<SyncRunRecordingInput> = {}): SyncRunRecordingInput => ({
  destinationCalendarId: fixture.family,
  pausedSourceCalendarIds: new Set(),
  readSourceCalendarIds: new Set([fixture.work, fixture.school]),
  sourceOutcomes: {
    [fixture.school]: { copied: 3, skipped: 0, skippedBy: {} },
    [fixture.work]: { copied: 7, skipped: 2, skippedBy: { "skip:all_day": { count: 2, name: "All-day events" } } },
  },
  sourceTallies: {},
  ...overrides,
});

interface RunRow {
  payload: { added: number; failed: number; removed: number };
  syncId: string;
}

const readRuns = (database: DatabaseInstance, syncId: string) => rows<RunRow>(database, sql`
  SELECT "payload", "syncId" FROM "sync_activity" WHERE "syncId" = ${syncId} AND "kind" = 'run' ORDER BY "createdAt", "id"
`);

const readDays = (database: DatabaseInstance, syncId: string) => rows<{ added: number; isToday: boolean; removed: number }>(database, sql`
  SELECT "added", "removed", "day" = (now() AT TIME ZONE 'utc')::date AS "isToday"
  FROM "sync_activity_days" WHERE "syncId" = ${syncId} ORDER BY "day"
`);

interface PairRow {
  copiedCount: number;
  failedCount: number;
  lastErrorAt: Date | null;
  lastSyncedAt: Date | null;
  skippedBy: unknown;
  skippedCount: number;
  sourceCalendarId: string;
  version: string;
}

const readPairs = (database: DatabaseInstance, fixture: Fixture) => rows<PairRow>(database, sql`
  SELECT "copiedCount", "failedCount", "lastErrorAt", "lastSyncedAt", "skippedBy", "skippedCount", "sourceCalendarId", xmin::text AS "version"
  FROM "source_destination_mappings" WHERE "destinationCalendarId" = ${fixture.family} ORDER BY "sourceCalendarId"
`);

const pairCounts = (pairs: PairRow[]) => pairs.map(({ copiedCount, failedCount, lastErrorAt, skippedBy, skippedCount, sourceCalendarId }) => ({
  copiedCount, failedCount, lastErrorAt, skippedBy, skippedCount, sourceCalendarId,
}));
const pairStamps = (pairs: PairRow[]) => pairs.map((pair) => new Date(pair.lastSyncedAt ?? 0).getTime());

describe.skipIf(!ADMIN_DATABASE_URL)("sync run recording against Postgres", () => {
  let connection: DatabaseInstance | null = null;
  const connected = (): DatabaseInstance => {
    if (!connection) {
      throw new Error("The test database isn't connected");
    }
    return connection;
  };

  beforeAll(async () => {
    await withAdmin((admin) => admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`));
    await migrate();
    connection = await createDatabase(databaseUrl(), { maxConnections: 2 });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (connection) {
      closeDatabase(connection, { graceSeconds: 1 });
    }
    await withAdmin((admin) => admin.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`));
  });

  it("credits each sync on a shared destination and adds to today's UTC day", async () => {
    const database = connected();
    const fixture = await seed(database);

    await recordSyncRun(database, runInput(fixture, {
      sourceTallies: {
        [fixture.school]: { ...NO_TALLY, removed: 2 },
        [fixture.work]: { ...NO_TALLY, added: 3, updated: 9 },
      },
    }));
    await recordSyncRun(database, runInput(fixture, {
      sourceTallies: { [fixture.work]: { ...NO_TALLY, added: 1 } },
    }));

    const workRuns = await readRuns(database, fixture.workSync);
    const schoolRuns = await readRuns(database, fixture.schoolSync);
    expect(workRuns.map(({ payload }) => payload)).toMatchObject([
      { added: 3, failed: 0, removed: 0 },
      { added: 1, failed: 0, removed: 0 },
    ]);
    expect(schoolRuns.map(({ payload }) => payload)).toMatchObject([{ added: 0, removed: 2 }]);
    expect(await readDays(database, fixture.workSync)).toEqual([{ added: 4, isToday: true, removed: 0 }]);
    expect(await readDays(database, fixture.schoolSync)).toEqual([{ added: 0, isToday: true, removed: 2 }]);

    const pairs = await readPairs(database, fixture);
    expect(pairs.find((pair) => pair.sourceCalendarId === fixture.work)).toMatchObject({
      copiedCount: 7,
      skippedBy: [{ count: 2, name: "All-day events", ruleId: "skip:all_day" }],
      skippedCount: 2,
    });
    expect(pairs.every((pair) => pair.lastSyncedAt !== null)).toBe(true);
  });

  it("only moves lastSyncedAt forward and logs nothing when nothing changed", async () => {
    const database = connected();
    const fixture = await seed(database);
    await recordSyncRun(database, runInput(fixture));
    const before = await readPairs(database, fixture);

    await recordSyncRun(database, runInput(fixture));

    const after = await readPairs(database, fixture);
    expect(pairCounts(after)).toEqual(pairCounts(before));
    expect(pairStamps(after).every((stamp, index) => stamp > (pairStamps(before)[index] ?? 0))).toBe(true);
    expect(await readRuns(database, fixture.workSync)).toEqual([]);
  });

  it("doesn't stamp a pair whose source wasn't read, or a paused sync's pair", async () => {
    const database = connected();
    const fixture = await seed(database);
    await database.execute(sql`UPDATE "syncs" SET "paused" = true WHERE "id" = ${fixture.schoolSync}`);

    await recordSyncRun(database, runInput(fixture, {
      readSourceCalendarIds: new Set(),
      sourceTallies: { [fixture.school]: { ...NO_TALLY, removed: 5 } },
    }));

    const pairs = await readPairs(database, fixture);
    expect(pairs.map(({ copiedCount, lastSyncedAt }) => ({ copiedCount, lastSyncedAt }))).toEqual([
      { copiedCount: 0, lastSyncedAt: null },
      { copiedCount: 0, lastSyncedAt: null },
    ]);
    expect(await readRuns(database, fixture.schoolSync)).toEqual([]);
  });

  it("prunes only run rows past 200 per sync, and day rows older than 30 days", async () => {
    const database = connected();
    const fixture = await seed(database);
    for (const syncId of [fixture.workSync, fixture.schoolSync]) {
      await database.execute(sql`
        INSERT INTO "sync_activity" ("kind", "payload", "syncId", "createdAt")
        SELECT 'run', '{"added":1,"removed":0,"failed":0}'::jsonb, ${syncId}, now() - make_interval(mins => position)
        FROM generate_series(1, 205) AS position
      `);
    }
    await database.execute(sql`
      INSERT INTO "sync_activity" ("kind", "payload", "syncId", "createdAt")
      SELECT 'change', '{}'::jsonb, ${fixture.workSync}, now() - interval '1 year' FROM generate_series(1, 3)
    `);
    await database.execute(sql`
      INSERT INTO "sync_activity_days" ("syncId", "day", "added", "removed")
      VALUES (${fixture.workSync}, (now() AT TIME ZONE 'utc')::date - 40, 9, 0),
             (${fixture.workSync}, (now() AT TIME ZONE 'utc')::date - 10, 4, 0)
    `);

    await recordSyncRun(database, runInput(fixture, { sourceTallies: { [fixture.work]: { ...NO_TALLY, added: 1 } } }));

    const counts = await rows<{ kind: string; syncId: string; total: number }>(database, sql`
      SELECT "kind", "syncId", count(*)::integer AS "total" FROM "sync_activity"
      WHERE "syncId" IN (${fixture.workSync}, ${fixture.schoolSync}) GROUP BY "kind", "syncId"
    `);
    expect(counts).toEqual(expect.arrayContaining([
      { kind: "run", syncId: fixture.workSync, total: 200 },
      { kind: "change", syncId: fixture.workSync, total: 3 },
      { kind: "run", syncId: fixture.schoolSync, total: 205 },
    ]));
    const runs = await readRuns(database, fixture.workSync);
    const days = await readDays(database, fixture.workSync);
    expect(runs.at(-1)?.payload).toMatchObject({ added: 1 });
    expect(days.map(({ added }) => added)).toEqual([4, 1]);
  });

  it("marks a thrown attempt once, then clears it and logs the recovery", async () => {
    const database = connected();
    const fixture = await seed(database);

    await recordSyncFailure(database, fixture.family);
    const failing = await readPairs(database, fixture);
    await recordSyncFailure(database, fixture.family);

    expect(failing.every((pair) => pair.lastErrorAt !== null)).toBe(true);
    const failedRuns = await readRuns(database, fixture.workSync);
    expect(await readPairs(database, fixture)).toEqual(failing);
    expect(failedRuns.map(({ payload }) => payload)).toMatchObject([{ failed: 1 }]);

    await recordSyncRun(database, runInput(fixture));

    const recovered = await readPairs(database, fixture);
    expect(recovered.map(({ lastErrorAt }) => lastErrorAt)).toEqual([null, null]);
    for (const syncId of [fixture.workSync, fixture.schoolSync]) {
      const runs = await readRuns(database, syncId);
      expect(runs.map(({ payload }) => payload.failed)).toEqual([1, 0]);
    }
    expect(await readDays(database, fixture.workSync)).toEqual([]);
  });
});
