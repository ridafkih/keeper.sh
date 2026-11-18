import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { getEventsForCalendarsWithDiagnostics } from "@keeper.sh/calendar";
import { NO_SYNC_RULE_OVERRIDES } from "@keeper.sh/data-schemas";
import type { SyncRuleOverrides } from "@keeper.sh/data-schemas";
import {
  readCustomizedDestinationIds,
  readMappingSyncRules,
  writeMappingSyncRuleOverrides,
} from "../../src/utils/mapping-sync-rules";
import {
  createSetDestinationsTransaction,
  createSetSourcesTransaction,
  runSetDestinationsForSource,
  runSetSourcesForDestination,
} from "../../src/utils/source-destination-mappings";

type Database = Awaited<ReturnType<typeof createDatabase>>;

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_destination_sync_rules_${process.pid}`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_START = new Date("2031-03-03T00:00:00.000Z");
const WINDOW = {
  timeMax: new Date(WINDOW_START.getTime() + 30 * DAY_MS),
  timeMin: WINDOW_START,
};

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeConnection = async (statement: string): Promise<void> => {
  const connection = new SQL(administrativeUrl ?? "postgres://localhost", { max: 1 });
  try {
    await connection.unsafe(statement);
  } finally {
    await connection.close();
  }
};

const runMigrations = async (): Promise<void> => {
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Migration failed: ${result.stdout.toString()}${result.stderr.toString()}`);
  }
};

const connections: Database[] = [];

const db = (): Database => {
  const [connection] = connections;
  if (!connection) {
    throw new Error("The scratch database is not connected");
  }
  return connection;
};

const seedUser = async (): Promise<string> => {
  const userId = `user-${crypto.randomUUID()}`;
  await db().execute(
    sql`INSERT INTO "user" ("id", "email", "name") VALUES (${userId}, ${`${userId}@example.com`}, 'Rules Fixture')`,
  );
  return userId;
};

const seedAccount = async (userId: string, provider = "google"): Promise<string> => {
  const [account] = await db()
    .insert(calendarAccountsTable)
    .values({ authType: "oauth", provider, userId })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Account fixture was not inserted");
  }
  return account.id;
};

const seedCalendar = async (
  userId: string,
  accountId: string,
  name: string,
  capabilities: string[],
): Promise<string> => {
  const [calendar] = await db()
    .insert(calendarsTable)
    .values({ accountId, calendarType: "oauth", capabilities, name, userId })
    .returning({ id: calendarsTable.id });
  if (!calendar) {
    throw new Error("Calendar fixture was not inserted");
  }
  return calendar.id;
};

interface EventSeed {
  title: string;
  startOffsetHours: number;
  isAllDay?: boolean;
  availability?: string;
  sourceEventType?: string;
}

const seedEvent = async (calendarId: string, seed: EventSeed): Promise<void> => {
  const startTime = new Date(WINDOW_START.getTime() + seed.startOffsetHours * HOUR_MS);
  let durationMs = HOUR_MS;
  if (seed.isAllDay) {
    durationMs = DAY_MS;
  }
  await db().insert(eventStatesTable).values({
    availability: seed.availability ?? "busy",
    calendarId,
    description: `${seed.title} description`,
    endTime: new Date(startTime.getTime() + durationMs),
    isAllDay: seed.isAllDay ?? false,
    location: `${seed.title} location`,
    sourceEventType: seed.sourceEventType ?? "default",
    sourceEventUid: `${seed.title}@fixture`,
    startTime,
    title: seed.title,
  });
};

const setDestinations = async (
  userId: string,
  sourceId: string,
  destinationIds: string[],
): Promise<void> => {
  await runSetDestinationsForSource(userId, sourceId, destinationIds, {
    withTransaction: (callback) =>
      db().transaction((transaction) =>
        callback(createSetDestinationsTransaction(transaction))),
  });
};

const setSources = async (
  userId: string,
  destinationId: string,
  sourceIds: string[],
): Promise<void> => {
  await runSetSourcesForDestination(userId, destinationId, sourceIds, {
    withTransaction: (callback) =>
      db().transaction((transaction) =>
        callback(createSetSourcesTransaction(transaction))),
  });
};

interface World {
  userId: string;
  accountId: string;
  sourceId: string;
  workId: string;
  familyId: string;
}

const SOURCE_NAME = "Personal";

const seedWorld = async (provider = "google"): Promise<World> => {
  const userId = await seedUser();
  const accountId = await seedAccount(userId, provider);
  const sourceId = await seedCalendar(userId, accountId, SOURCE_NAME, ["pull"]);
  const workId = await seedCalendar(userId, accountId, "Work", ["pull", "push"]);
  const familyId = await seedCalendar(userId, accountId, "Family", ["pull", "push"]);

  await seedEvent(sourceId, { startOffsetHours: 10, title: "Dentist" });
  await seedEvent(sourceId, { startOffsetHours: 36, title: "Lunch with Sam" });
  await seedEvent(sourceId, { isAllDay: true, startOffsetHours: 72, title: "Offsite" });
  await seedEvent(sourceId, {
    availability: "free",
    startOffsetHours: 100,
    title: "Hold for travel",
  });
  await seedEvent(sourceId, {
    sourceEventType: "focusTime",
    startOffsetHours: 130,
    title: "Deep work",
  });

  await setDestinations(userId, sourceId, [workId, familyId]);
  return { accountId, familyId, sourceId, userId, workId };
};

const writeOverrides = (
  world: World,
  destinationId: string,
  updates: Partial<SyncRuleOverrides>,
) => writeMappingSyncRuleOverrides(db(), world.userId, world.sourceId, destinationId, updates);

const readEvents = async (sourceId: string, destinationCalendarId?: string) => {
  const read = await getEventsForCalendarsWithDiagnostics(
    db(),
    [sourceId],
    WINDOW,
    { destinationCalendarId },
  );
  return read.events;
};

const readSummaries = async (sourceId: string, destinationCalendarId?: string) => {
  const events = await readEvents(sourceId, destinationCalendarId);
  return events.map((event) => event.summary);
};

const readMappingRow = async (sourceId: string, destinationId: string) => {
  const [row] = await db()
    .select()
    .from(sourceDestinationMappingsTable)
    .where(
      and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceId),
        eq(sourceDestinationMappingsTable.destinationCalendarId, destinationId),
      ),
    );
  return row ?? null;
};

const readSyncRequestId = async (userId: string): Promise<string | null> => {
  const [request] = await db()
    .select({ requestId: userSyncRequestsTable.requestId })
    .from(userSyncRequestsTable)
    .where(eq(userSyncRequestsTable.userId, userId));
  return request?.requestId ?? null;
};

const clearSyncRequest = (userId: string) =>
  db().delete(userSyncRequestsTable).where(eq(userSyncRequestsTable.userId, userId));

const ALL_TITLES = ["Dentist", "Lunch with Sam", "Offsite", "Hold for travel", "Deep work"];
const ALL_HIDDEN = ALL_TITLES.map(() => SOURCE_NAME);

describe.skipIf(!administrativeUrl)("per-destination sync rules", () => {
  beforeAll(async () => {
    await withAdministrativeConnection(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await withAdministrativeConnection(`CREATE DATABASE "${databaseName}"`);
    await runMigrations();
    connections.push(
      await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 4 }),
    );
  }, 300_000);

  afterAll(async () => {
    for (const connection of connections) {
      closeDatabase(connection, { graceSeconds: 1 });
    }
    await withAdministrativeConnection(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  });

  describe("a new mapping", () => {
    it("has no overrides and syncs with the source calendar's rules", async () => {
      const world = await seedWorld();

      const rules = await readMappingSyncRules(
        db(),
        world.userId,
        world.sourceId,
        world.workId,
      );

      expect(rules?.overrides).toEqual(NO_SYNC_RULE_OVERRIDES);
      expect(rules?.effectiveRules).toEqual(rules?.sourceRules);
      expect(rules?.sourceProvider).toBe("google");
      expect(await readSummaries(world.sourceId, world.workId)).toEqual(ALL_HIDDEN);
      expect(await readCustomizedDestinationIds(db(), world.userId, world.sourceId))
        .toEqual([]);
    });
  });

  describe("syncing one source to two destinations", () => {
    it("shows event names on one destination while hiding them on the other", async () => {
      const world = await seedWorld();

      await writeOverrides(world, world.familyId, { excludeEventName: false });

      expect(await readSummaries(world.sourceId, world.familyId)).toEqual(ALL_TITLES);
      expect(await readSummaries(world.sourceId, world.workId)).toEqual(ALL_HIDDEN);
    });

    it("hides event names on one destination when the source shows them", async () => {
      const world = await seedWorld();
      await db()
        .update(calendarsTable)
        .set({ excludeEventName: false })
        .where(eq(calendarsTable.id, world.sourceId));

      await writeOverrides(world, world.workId, {
        customEventName: "Busy ({{calendar_name}})",
        excludeEventName: true,
      });

      expect(await readSummaries(world.sourceId, world.familyId)).toEqual(ALL_TITLES);
      expect(await readSummaries(world.sourceId, world.workId))
        .toEqual(ALL_TITLES.map(() => "Busy (Personal)"));
    });

    it("uses a different event name template per destination", async () => {
      const world = await seedWorld();

      await writeOverrides(world, world.workId, { customEventName: "Unavailable" });
      await writeOverrides(world, world.familyId, { customEventName: "{{event_name}} (R)" });

      expect(await readSummaries(world.sourceId, world.workId))
        .toEqual(ALL_TITLES.map(() => "Unavailable"));
      expect(await readSummaries(world.sourceId, world.familyId))
        .toEqual(ALL_TITLES.map((title) => `${title} (R)`));
    });

    it("applies description, location and privacy overrides to one destination only", async () => {
      const world = await seedWorld();

      await writeOverrides(world, world.familyId, {
        excludeEventDescription: false,
        excludeEventLocation: false,
        markEventsAsPrivate: true,
      });

      const [familyEvent] = await readEvents(world.sourceId, world.familyId);
      const [workEvent] = await readEvents(world.sourceId, world.workId);

      expect(familyEvent).toMatchObject({
        description: "Dentist description",
        isPrivate: true,
        location: "Dentist location",
      });
      expect(workEvent?.description).toBeUndefined();
      expect(workEvent?.location).toBeUndefined();
      expect(workEvent?.isPrivate).toBeUndefined();
    });

    it("disables reminders on one destination only", async () => {
      const world = await seedWorld();

      await writeOverrides(world, world.workId, { disableEventReminders: true });

      const [workEvent] = await readEvents(world.sourceId, world.workId);
      const [familyEvent] = await readEvents(world.sourceId, world.familyId);

      expect(workEvent?.remindersDisabled).toBe(true);
      expect(familyEvent?.remindersDisabled).toBeFalsy();
    });

    it("keeps reminders on one destination when the source disables them", async () => {
      const world = await seedWorld();
      await db()
        .update(calendarsTable)
        .set({ disableEventReminders: true })
        .where(eq(calendarsTable.id, world.sourceId));

      await writeOverrides(world, world.familyId, { disableEventReminders: false });

      const [workEvent] = await readEvents(world.sourceId, world.workId);
      const [familyEvent] = await readEvents(world.sourceId, world.familyId);

      expect(workEvent?.remindersDisabled).toBe(true);
      expect(familyEvent?.remindersDisabled).toBeFalsy();
    });

    it("lets an override switch off a rule the source switches on", async () => {
      const world = await seedWorld();
      await db()
        .update(calendarsTable)
        .set({ excludeAllDayEvents: true, markEventsAsPrivate: true })
        .where(eq(calendarsTable.id, world.sourceId));

      await writeOverrides(world, world.familyId, {
        excludeAllDayEvents: false,
        excludeEventName: false,
        markEventsAsPrivate: false,
      });

      const familyEvents = await readEvents(world.sourceId, world.familyId);
      const workEvents = await readEvents(world.sourceId, world.workId);

      expect(familyEvents.map((event) => event.summary)).toContain("Offsite");
      expect(familyEvents.some((event) => event.isPrivate)).toBe(false);
      expect(workEvents).toHaveLength(ALL_TITLES.length - 1);
      expect(workEvents.every((event) => event.isPrivate === true)).toBe(true);
    });

    it("filters different events out of each destination", async () => {
      const world = await seedWorld();

      await writeOverrides(world, world.workId, {
        excludeAllDayEvents: true,
        excludeEventName: false,
        excludeTitleKeywords: ["LUNCH"],
      });
      await writeOverrides(world, world.familyId, {
        excludeAvailabilities: ["free"],
        excludeEventName: false,
        excludeFocusTime: true,
      });

      expect(await readSummaries(world.sourceId, world.workId))
        .toEqual(["Dentist", "Hold for travel", "Deep work"]);
      expect(await readSummaries(world.sourceId, world.familyId))
        .toEqual(["Dentist", "Lunch with Sam", "Offsite"]);
    });

    it("lets an empty keyword override sync events the source filters out", async () => {
      const world = await seedWorld();
      await db()
        .update(calendarsTable)
        .set({ excludeAvailabilities: ["free"], excludeTitleKeywords: ["dentist"] })
        .where(eq(calendarsTable.id, world.sourceId));

      await writeOverrides(world, world.familyId, {
        excludeAvailabilities: [],
        excludeTitleKeywords: [],
      });

      expect(await readEvents(world.sourceId, world.familyId)).toHaveLength(ALL_TITLES.length);
      expect(await readEvents(world.sourceId, world.workId)).toHaveLength(ALL_TITLES.length - 2);
    });

    it("keeps inherited rules following the source while overridden rules stay put", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      await db()
        .update(calendarsTable)
        .set({ customEventName: "Booked", excludeEventLocation: false })
        .where(eq(calendarsTable.id, world.sourceId));

      const [familyEvent] = await readEvents(world.sourceId, world.familyId);
      const [workEvent] = await readEvents(world.sourceId, world.workId);

      expect(familyEvent?.summary).toBe("Dentist");
      expect(familyEvent?.location).toBe("Dentist location");
      expect(workEvent?.summary).toBe("Booked");
      expect(workEvent?.location).toBe("Dentist location");
    });

    it("reads the source calendar's rules when no destination is named", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      expect(await readSummaries(world.sourceId)).toEqual(ALL_HIDDEN);
    });

    it("applies each source's own override when a destination has several sources", async () => {
      const world = await seedWorld();
      const secondSourceId = await seedCalendar(world.userId, world.accountId, "Side", ["pull"]);
      await seedEvent(secondSourceId, { startOffsetHours: 12, title: "Gig" });
      await setSources(world.userId, world.familyId, [world.sourceId, secondSourceId]);

      await writeOverrides(world, world.familyId, { excludeEventName: false });

      const read = await getEventsForCalendarsWithDiagnostics(
        db(),
        [world.sourceId, secondSourceId],
        WINDOW,
        { destinationCalendarId: world.familyId },
      );

      expect(read.events.map((event) => event.summary).toSorted())
        .toEqual([...ALL_TITLES, "Side"].toSorted());
    });
  });

  describe("clearing overrides", () => {
    it("returns a field to the source calendar's rule", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, {
        excludeEventName: false,
        excludeTitleKeywords: ["dentist"],
      });

      const cleared = await writeOverrides(world, world.familyId, {
        excludeEventName: null,
        excludeTitleKeywords: null,
      });

      expect(cleared?.overrides).toEqual(NO_SYNC_RULE_OVERRIDES);
      expect(await readSummaries(world.sourceId, world.familyId)).toEqual(ALL_HIDDEN);
    });

    it("leaves untouched overrides in place when one field changes", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, {
        excludeEventName: false,
        markEventsAsPrivate: true,
      });

      const updated = await writeOverrides(world, world.familyId, { excludeEventName: null });

      expect(updated?.overrides).toEqual({
        ...NO_SYNC_RULE_OVERRIDES,
        markEventsAsPrivate: true,
      });
    });
  });

  describe("listing customized destinations", () => {
    it("names only destinations holding at least one override", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeOutOfOffice: false });

      expect(await readCustomizedDestinationIds(db(), world.userId, world.sourceId))
        .toEqual([world.familyId]);

      await writeOverrides(world, world.familyId, { excludeOutOfOffice: null });

      expect(await readCustomizedDestinationIds(db(), world.userId, world.sourceId))
        .toEqual([]);
    });

    it("does not list another user's customized destinations", async () => {
      const world = await seedWorld();
      const stranger = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      expect(await readCustomizedDestinationIds(db(), stranger.userId, world.sourceId))
        .toEqual([]);
    });
  });

  describe("editing which destinations a source syncs to", () => {
    it("keeps overrides and the mapping row when another destination is added", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });
      const before = await readMappingRow(world.sourceId, world.familyId);
      const extraId = await seedCalendar(world.userId, world.accountId, "Extra", ["push"]);

      await setDestinations(world.userId, world.sourceId, [
        world.workId,
        world.familyId,
        extraId,
      ]);

      const after = await readMappingRow(world.sourceId, world.familyId);
      expect(after).toEqual(before);
      expect(after?.excludeEventName).toBe(false);
      expect(await readMappingRow(world.sourceId, extraId)).toMatchObject(NO_SYNC_RULE_OVERRIDES);
    });

    it("keeps overrides when a sibling destination is removed", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { customEventName: "Family time" });

      await setDestinations(world.userId, world.sourceId, [world.familyId]);

      expect(await readMappingRow(world.sourceId, world.workId)).toBeNull();
      const mapping = await readMappingRow(world.sourceId, world.familyId);
      expect(mapping?.customEventName)
        .toBe("Family time");
    });

    it("keeps overrides when the same destination list is saved again", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.workId, { excludeTitleKeywords: ["lunch"] });

      await setDestinations(world.userId, world.sourceId, [world.familyId, world.workId]);

      const mapping = await readMappingRow(world.sourceId, world.workId);

      expect(mapping?.excludeTitleKeywords)
        .toEqual(["lunch"]);
    });

    it("drops overrides with the mapping, so a re-added destination starts clean", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      await setDestinations(world.userId, world.sourceId, [world.workId]);
      await setDestinations(world.userId, world.sourceId, [world.workId, world.familyId]);

      expect(await readMappingRow(world.sourceId, world.familyId))
        .toMatchObject(NO_SYNC_RULE_OVERRIDES);
    });

    it("removes every mapping when the destination list is emptied", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      await setDestinations(world.userId, world.sourceId, []);

      expect(await readMappingRow(world.sourceId, world.familyId)).toBeNull();
      expect(await readMappingRow(world.sourceId, world.workId)).toBeNull();
    });

    it("leaves another source's overrides for the same destination alone", async () => {
      const world = await seedWorld();
      const secondSourceId = await seedCalendar(world.userId, world.accountId, "Side", ["pull"]);
      await setDestinations(world.userId, secondSourceId, [world.familyId]);
      await writeMappingSyncRuleOverrides(
        db(),
        world.userId,
        secondSourceId,
        world.familyId,
        { markEventsAsPrivate: true },
      );

      await setDestinations(world.userId, world.sourceId, [world.workId]);

      const mapping = await readMappingRow(secondSourceId, world.familyId);

      expect(mapping?.markEventsAsPrivate)
        .toBe(true);
    });
  });

  describe("editing which sources a destination receives", () => {
    it("keeps overrides and the mapping row when another source is added", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });
      const before = await readMappingRow(world.sourceId, world.familyId);
      const secondSourceId = await seedCalendar(world.userId, world.accountId, "Side", ["pull"]);

      await setSources(world.userId, world.familyId, [world.sourceId, secondSourceId]);

      expect(await readMappingRow(world.sourceId, world.familyId)).toEqual(before);
      expect(await readMappingRow(secondSourceId, world.familyId))
        .toMatchObject(NO_SYNC_RULE_OVERRIDES);
    });

    it("drops the mapping and its overrides when the source is removed", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.familyId, { excludeEventName: false });

      await setSources(world.userId, world.familyId, []);

      expect(await readMappingRow(world.sourceId, world.familyId)).toBeNull();
      expect(await readMappingRow(world.sourceId, world.workId)).not.toBeNull();
    });

    it("leaves the source's overrides for other destinations alone", async () => {
      const world = await seedWorld();
      await writeOverrides(world, world.workId, { excludeEventLocation: false });

      await setSources(world.userId, world.familyId, []);

      const mapping = await readMappingRow(world.sourceId, world.workId);

      expect(mapping?.excludeEventLocation)
        .toBe(false);
    });
  });

  describe("ownership", () => {
    it("hides a mapping from a user who owns neither calendar", async () => {
      const world = await seedWorld();
      const stranger = await seedWorld();

      expect(await readMappingSyncRules(db(), stranger.userId, world.sourceId, world.familyId))
        .toBeNull();
    });

    it("refuses a write from a user who owns neither calendar", async () => {
      const world = await seedWorld();
      const stranger = await seedWorld();
      const before = await readMappingRow(world.sourceId, world.familyId);
      await clearSyncRequest(stranger.userId);

      const written = await writeMappingSyncRuleOverrides(
        db(),
        stranger.userId,
        world.sourceId,
        world.familyId,
        { excludeEventName: false },
      );

      expect(written).toBeNull();
      expect(await readMappingRow(world.sourceId, world.familyId)).toEqual(before);
      expect(await readSyncRequestId(stranger.userId)).toBeNull();
    });

    it("refuses a mapping that crosses users even when the row exists", async () => {
      const world = await seedWorld();
      const stranger = await seedWorld();
      await db().insert(sourceDestinationMappingsTable).values({
        destinationCalendarId: stranger.familyId,
        sourceCalendarId: world.sourceId,
      });

      const asSourceOwner = await writeMappingSyncRuleOverrides(
        db(),
        world.userId,
        world.sourceId,
        stranger.familyId,
        { excludeEventName: false },
      );
      const asDestinationOwner = await writeMappingSyncRuleOverrides(
        db(),
        stranger.userId,
        world.sourceId,
        stranger.familyId,
        { excludeEventName: false },
      );

      expect(asSourceOwner).toBeNull();
      expect(asDestinationOwner).toBeNull();
      const mapping = await readMappingRow(world.sourceId, stranger.familyId);
      expect(mapping?.excludeEventName)
        .toBeNull();
    });

    it("returns nothing for a pair that is not mapped", async () => {
      const world = await seedWorld();
      await setDestinations(world.userId, world.sourceId, [world.workId]);
      await clearSyncRequest(world.userId);

      const written = await writeOverrides(world, world.familyId, { excludeEventName: false });

      expect(written).toBeNull();
      expect(await readSyncRequestId(world.userId)).toBeNull();
    });
  });

  describe("requesting a sync", () => {
    it("records a fresh sync request with every override write", async () => {
      const world = await seedWorld();
      await clearSyncRequest(world.userId);

      await writeOverrides(world, world.familyId, { excludeEventName: false });
      const firstRequestId = await readSyncRequestId(world.userId);
      await writeOverrides(world, world.familyId, { excludeEventName: null });
      const secondRequestId = await readSyncRequestId(world.userId);

      expect(firstRequestId).not.toBeNull();
      expect(secondRequestId).not.toBeNull();
      expect(secondRequestId).not.toBe(firstRequestId);
    });
  });

  describe("provider reported on the mapping", () => {
    it("is the source calendar's provider", async () => {
      const world = await seedWorld("outlook");

      const rules = await readMappingSyncRules(
        db(),
        world.userId,
        world.sourceId,
        world.familyId,
      );

      expect(rules?.sourceProvider).toBe("outlook");
    });
  });

  describe("upgrading an existing installation", () => {
    it("adds every override column as nullable with no default", async () => {
      const columns = await db().execute<{
        column_default: string | null;
        column_name: string;
        is_nullable: string;
      }>(
        sql`SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'source_destination_mappings'
              AND column_name IN ${Object.keys(NO_SYNC_RULE_OVERRIDES)}`,
      );

      expect(columns).toHaveLength(Object.keys(NO_SYNC_RULE_OVERRIDES).length);
      for (const column of columns) {
        expect(column.is_nullable).toBe("YES");
        expect(column.column_default).toBeNull();
      }
    });
  });
});
