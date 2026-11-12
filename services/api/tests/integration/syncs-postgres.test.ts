import { join } from "node:path";
import { SQL } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
  syncActivityDaysTable,
  syncActivityTable,
  syncCalendarsTable,
  syncsTable,
} from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import type { CreateSyncBody } from "@keeper.sh/data-schemas";
import { and, eq, sql } from "drizzle-orm";
import {
  SyncConflictError,
  SyncStaleError,
  createSyncWriteTransaction,
  deleteSyncRow,
  findOwnedRequestedDestinationIds,
  findSyncDestinationIds,
  findSyncDetail,
  findSyncForUser,
  listSyncActivity,
  listSyncs,
  runCreateSync,
  runUpdateSync,
} from "../../src/utils/syncs";
import type { SyncWriteDependencies } from "../../src/utils/syncs";

// Runs against a real Postgres, in its own throwaway db(), when MIGRATION_TEST_DATABASE_URL is set.
const ADMIN_DATABASE_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const DATABASE_PACKAGE_ROOT = join(import.meta.dirname, "../../../../packages/database");
const SETUP_TIMEOUT_MS = 180_000;

const ALICE = "alice";
const BOB = "bob";

type Database = Awaited<ReturnType<typeof createDatabase>>;

const runMigrations = async (databaseUrl: string): Promise<void> => {
  const runner = Bun.spawn(["bun", "scripts/migrate.ts"], {
    cwd: DATABASE_PACKAGE_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, failure] = await Promise.all([runner.exited, new Response(runner.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`Migration runner exited ${exitCode}: ${failure}`);
  }
};

const withAdmin = async (run: (admin: SQL) => Promise<unknown>): Promise<void> => {
  const admin = new SQL(ADMIN_DATABASE_URL ?? "");
  try {
    await run(admin);
  } finally {
    await admin.close();
  }
};

describe.skipIf(!ADMIN_DATABASE_URL)("sync queries against Postgres", () => {
  const databaseName = `keeper_api_syncs_${crypto.randomUUID().replaceAll("-", "")}`;
  const harness: { database: Database | null } = { database: null };
  const db = (): Database => {
    if (!harness.database) {
      throw new Error("Postgres isn't set up");
    }
    return harness.database;
  };
  const calendars: Record<string, string> = {};

  const dependencies = (): SyncWriteDependencies => ({
    canAddSync: () => Promise.resolve(true),
    canUseEventFilters: () => Promise.resolve(true),
    getSyncCalendarLimit: () => Promise.resolve(Number.POSITIVE_INFINITY),
    withTransaction: (callback) => db().transaction((client) => callback(createSyncWriteTransaction(client))),
  });

  const id = (name: string): string => {
    const calendarId = calendars[name];
    if (!calendarId) {
      throw new Error(`No calendar ${name}`);
    }
    return calendarId;
  };

  const oneWay = (name: string, sources: string[], destinations: string[]): CreateSyncBody => ({
    destinationCalendarIds: destinations.map((calendar) => id(calendar)),
    mode: "one_way",
    name,
    sourceCalendarIds: sources.map((calendar) => id(calendar)),
  });

  const seedUser = async (userId: string, names: string[]): Promise<void> => {
    await db().insert(userTable).values({ email: `${userId}@keeper.test`, id: userId, name: userId });
    const [account] = await db()
      .insert(calendarAccountsTable)
      .values({ authType: "oauth", provider: "google", userId })
      .returning({ id: calendarAccountsTable.id });
    if (!account) {
      throw new Error("No account");
    }
    for (const name of names) {
      const [calendar] = await db()
        .insert(calendarsTable)
        .values({ accountId: account.id, calendarType: "oauth", capabilities: ["pull", "push"], name, userId })
        .returning({ id: calendarsTable.id });
      if (calendar) {
        calendars[name] = calendar.id;
      }
    }
  };

  const pairsOf = async (syncId: string) => await db()
    .select({
      destination: sourceDestinationMappingsTable.destinationCalendarId,
      id: sourceDestinationMappingsTable.id,
      source: sourceDestinationMappingsTable.sourceCalendarId,
    })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.syncId, syncId));

  const calendarsOf = async (syncId: string): Promise<string[]> => {
    const rows = await db()
      .select({ calendarId: syncCalendarsTable.calendarId, role: syncCalendarsTable.role })
      .from(syncCalendarsTable)
      .where(eq(syncCalendarsTable.syncId, syncId));
    return rows.map((row) => `${row.role}:${row.calendarId}`).toSorted();
  };

  const destinationsOf = async (syncId: string): Promise<string[]> => {
    const pairs = await pairsOf(syncId);
    return pairs.map((pair) => pair.destination);
  };

  const detailOf = async (userId: string, syncId: string) => {
    const detail = await findSyncDetail(db(), userId, syncId);
    if (!detail) {
      throw new Error(`No sync ${syncId} for ${userId}`);
    }
    return detail;
  };

  const summaryOf = async (syncId: string) => {
    const page = await listSyncActivity(db(), syncId, { before: null, limit: 1 });
    return page.summary;
  };

  beforeAll(async () => {
    await withAdmin((admin) => admin.unsafe(`CREATE DATABASE "${databaseName}"`));
    const databaseUrl = new URL(ADMIN_DATABASE_URL ?? "");
    databaseUrl.pathname = `/${databaseName}`;
    await runMigrations(databaseUrl.toString());
    harness.database = await createDatabase(databaseUrl.toString(), { maxConnections: 4 });
    await seedUser(ALICE, ["work", "personal", "family", "school", "gym", "doomed"]);
    await seedUser(BOB, ["bob-work", "bob-home"]);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (harness.database) {
      closeDatabase(harness.database);
    }
    await withAdmin((admin) => admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`));
  }, SETUP_TIMEOUT_MS);

  beforeEach(async () => {
    await db().delete(syncsTable);
    await db().update(calendarsTable).set({ disabled: false, failureCount: 0, ingestFailureCount: 0 });
    await db().update(calendarAccountsTable).set({ needsReauthentication: false });
  });

  describe("writes", () => {
    it("keeps a kept pair's row, drops removed ones and leaves the sync's calendars intact at commit", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Work Out", ["work"], ["personal", "family"]), dependencies());
      const before = await pairsOf(syncId);
      const kept = before.find((pair) => pair.destination === id("family"));

      await runUpdateSync(ALICE, syncId, { destinationCalendarIds: [id("family"), id("school")] }, dependencies());

      const pairs = await pairsOf(syncId);
      expect(pairs.map((pair) => pair.destination).toSorted()).toEqual([id("family"), id("school")].toSorted());
      expect(pairs.find((pair) => pair.destination === id("family"))?.id).toBe(kept?.id);
      expect(await calendarsOf(syncId)).toEqual([
        `destination:${id("family")}`,
        `destination:${id("school")}`,
        `source:${id("work")}`,
      ].toSorted());
    });

    it("switches a sync between modes without the prune trigger dropping a calendar", async () => {
      const syncId = await runCreateSync(ALICE, {
        memberCalendarIds: [id("work"), id("personal"), id("family")],
        mode: "both_ways",
        name: "Mesh",
      }, dependencies());

      await runUpdateSync(ALICE, syncId, { ...oneWay("Mesh", ["personal"], ["work"]), name: "Mesh" }, dependencies());

      const pairs = await pairsOf(syncId);
      expect(pairs.map((pair) => [pair.source, pair.destination])).toEqual([[id("personal"), id("work")]]);
      expect(await calendarsOf(syncId)).toEqual([`destination:${id("work")}`, `source:${id("personal")}`].toSorted());
    });

    it("finds a pair another of the user's syncs owns, on create and on update", async () => {
      await runCreateSync(ALICE, oneWay("Kids", ["work"], ["family"]), dependencies());
      const meId = await runCreateSync(ALICE, oneWay("Me", ["school"], ["personal"]), dependencies());

      const creating = runCreateSync(ALICE, oneWay("Everything", ["work"], ["family", "gym"]), dependencies());
      await expect(creating).rejects.toBeInstanceOf(SyncConflictError);
      await expect(creating).rejects.toMatchObject({
        conflicts: [{ destinationCalendarId: id("family"), sourceCalendarId: id("work"), syncName: "Kids" }],
      });

      await expect(runUpdateSync(ALICE, meId, { sourceCalendarIds: [id("school"), id("work")], destinationCalendarIds: [id("family")] }, dependencies()))
        .rejects.toBeInstanceOf(SyncConflictError);
      expect(await destinationsOf(meId)).toEqual([id("personal")]);
    });

    it("refuses a save against a version that has since changed, comparing what the API hands out", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Work Out", ["work"], ["personal"]), dependencies());
      const { updatedAt: opened } = await detailOf(ALICE, syncId);

      await runUpdateSync(ALICE, syncId, { expectedUpdatedAt: opened, name: "Renamed" }, dependencies());
      await expect(runUpdateSync(ALICE, syncId, { expectedUpdatedAt: opened, paused: true }, dependencies()))
        .rejects.toBeInstanceOf(SyncStaleError);
      const { updatedAt: reopened } = await detailOf(ALICE, syncId);
      await expect(runUpdateSync(ALICE, syncId, { expectedUpdatedAt: reopened, paused: true }, dependencies()))
        .resolves.toEqual([{ kind: "paused" }]);
    });

    it("renames and pauses a sync whose destination was deleted", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Doomed", ["gym"], ["doomed"]), dependencies());
      await db().delete(calendarsTable).where(eq(calendarsTable.id, id("doomed")));

      await expect(runUpdateSync(ALICE, syncId, { name: "Leftover" }, dependencies())).resolves.toHaveLength(1);
      await expect(runUpdateSync(ALICE, syncId, { paused: true }, dependencies())).resolves.toEqual([{ kind: "paused" }]);
      const { state } = await detailOf(ALICE, syncId);
      expect(state).toBe("paused");
    });
  });

  describe("authorization", () => {
    it("never reads, changes or deletes another user's sync", async () => {
      const syncId = await runCreateSync(BOB, oneWay("Bob's", ["bob-work"], ["bob-home"]), dependencies());

      expect(await findSyncDetail(db(), ALICE, syncId)).toBeNull();
      expect(await findSyncForUser(db(), ALICE, syncId)).toBeNull();
      expect(await findSyncDestinationIds(db(), ALICE, syncId)).toEqual([]);
      expect(await listSyncs(db(), ALICE)).toEqual([]);
      await expect(runUpdateSync(ALICE, syncId, { name: "Mine now" }, dependencies())).rejects.toMatchObject({ message: "Sync not found." });
      expect(await db().transaction((client) => deleteSyncRow(client, ALICE, syncId))).toBe(false);
      const { name } = await detailOf(BOB, syncId);
      expect(name).toBe("Bob's");
    });

    it("never lets a user put, or lock, another user's calendar", async () => {
      await expect(runCreateSync(ALICE, oneWay("Borrowed", ["work"], ["bob-home"]), dependencies()))
        .rejects.toMatchObject({ message: "Some calendars were not found." });
      expect(await findOwnedRequestedDestinationIds(db(), ALICE, oneWay("Borrowed", ["work"], ["bob-home", "personal"])))
        .toEqual([id("personal")]);
    });

    it("treats a malformed sync id as missing instead of failing in Postgres", async () => {
      expect(await findSyncDetail(db(), ALICE, "abc")).toBeNull();
      expect(await findSyncForUser(db(), ALICE, "abc")).toBeNull();
    });
  });

  describe("detail", () => {
    it("reports source and destination problems, but not a paused calendar, as the sync's state", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Health", ["work"], ["personal", "family"]), dependencies());
      const healthy = await detailOf(ALICE, syncId);
      expect(healthy.state).toBe("ok");

      await db().update(calendarsTable).set({ disabled: true }).where(eq(calendarsTable.id, id("work")));
      const paused = await findSyncDetail(db(), ALICE, syncId);
      expect(paused?.sources).toEqual([{ calendarId: id("work"), problem: "disabled" }]);
      expect(paused?.state).toBe("ok");

      await db().update(calendarsTable).set({ disabled: false, ingestFailureCount: 3 }).where(eq(calendarsTable.id, id("work")));
      const failingSource = await findSyncDetail(db(), ALICE, syncId);
      expect(failingSource?.sources).toEqual([{ calendarId: id("work"), problem: "failing" }]);
      expect(failingSource?.state).toBe("problem");

      await db().update(calendarsTable).set({ ingestFailureCount: 0 }).where(eq(calendarsTable.id, id("work")));
      await db()
        .update(sourceDestinationMappingsTable)
        .set({ lastErrorAt: new Date() })
        .where(eq(sourceDestinationMappingsTable.destinationCalendarId, id("family")));
      const failingDestination = await findSyncDetail(db(), ALICE, syncId);
      expect(failingDestination?.destinations.find((destination) => destination.calendarId === id("family"))?.problem).toBe("failing");
      expect(failingDestination?.state).toBe("problem");
      const [summary] = await listSyncs(db(), ALICE);
      expect(summary).not.toHaveProperty("sources");
    });
  });

  describe("activity", () => {
    it("pages through rows that share one microsecond without skipping or repeating any", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Busy", ["work"], ["personal"]), dependencies());
      await db().delete(syncActivityTable).where(eq(syncActivityTable.syncId, syncId));
      const shared = sql`'2026-10-06 09:00:00.123456+00'::timestamptz`;
      await db().insert(syncActivityTable).values(
        Array.from({ length: 5 }, (_unused, index) => ({ createdAt: shared, kind: "change", payload: { index, kind: "rules_changed" }, syncId })),
      );
      await db().insert(syncActivityTable).values([
        { createdAt: sql`'2026-10-06 09:00:00.123457+00'::timestamptz`, kind: "change", payload: { kind: "paused" }, syncId },
        { createdAt: sql`'2026-10-06 09:00:00.123455+00'::timestamptz`, kind: "change", payload: { kind: "resumed" }, syncId },
      ]);

      const seen: string[] = [];
      let before: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result = await listSyncActivity(db(), syncId, { before, limit: 2 });
        seen.push(...result.entries.map((entry) => entry.id));
        before = result.nextCursor;
        if (!before) {
          break;
        }
      }

      const all = await db().select({ id: syncActivityTable.id }).from(syncActivityTable).where(eq(syncActivityTable.syncId, syncId));
      expect(seen).toHaveLength(7);
      expect(new Set(seen)).toEqual(new Set(all.map((row) => row.id)));
    });

    it("sums the last seven UTC days of copies and the pairs' current skips", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Digest", ["work"], ["personal", "family"]), dependencies());
      const today = sql`(now() at time zone 'utc')::date`;
      await db().insert(syncActivityDaysTable).values([
        { added: 3, day: sql`${today}`, removed: 1, syncId },
        { added: 2, day: sql`${today} - 6`, removed: 0, syncId },
        { added: 100, day: sql`${today} - 7`, removed: 50, syncId },
      ]);
      await db()
        .update(sourceDestinationMappingsTable)
        .set({ skippedBy: [{ count: 4, name: "Focus time", ruleId: "skip:focus_time" }], skippedCount: 4 })
        .where(and(eq(sourceDestinationMappingsTable.syncId, syncId), eq(sourceDestinationMappingsTable.destinationCalendarId, id("personal"))));
      await db()
        .update(sourceDestinationMappingsTable)
        .set({
          skippedBy: [{ count: 1, name: "Focus time", ruleId: "skip:focus_time" }, { count: 2, name: "All-day events", ruleId: "skip:all_day" }],
          skippedCount: 3,
        })
        .where(and(eq(sourceDestinationMappingsTable.syncId, syncId), eq(sourceDestinationMappingsTable.destinationCalendarId, id("family"))));

      expect(await summaryOf(syncId)).toEqual({
        added: 5,
        removed: 1,
        skipped: 7,
        skippedBy: [
          { count: 5, name: "Focus time", ruleId: "skip:focus_time" },
          { count: 2, name: "All-day events", ruleId: "skip:all_day" },
        ],
      });
    });

    it("drops a removed destination's skips from the summary", async () => {
      const syncId = await runCreateSync(ALICE, oneWay("Shrinking", ["work"], ["personal", "family"]), dependencies());
      await db()
        .update(sourceDestinationMappingsTable)
        .set({ skippedBy: [{ count: 40, name: "Focus time", ruleId: "skip:focus_time" }], skippedCount: 40 })
        .where(eq(sourceDestinationMappingsTable.destinationCalendarId, id("family")));

      await runUpdateSync(ALICE, syncId, { destinationCalendarIds: [id("personal")] }, dependencies());

      expect(await summaryOf(syncId)).toMatchObject({ skipped: 0, skippedBy: [] });
    });
  });
});
