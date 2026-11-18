import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import {
  getEffectiveDestinationIdsForSource,
  getEffectiveDestinationRangesForSource,
  getEffectiveSourcesForDestination,
  getEventsForDestination,
} from "@keeper.sh/calendar";
import type { SyncRuleOverrides } from "@keeper.sh/data-schemas";
import { getCopiedEvents } from "../../src/queries/get-copied-events";
import { writeMappingSyncRuleOverrides } from "../../src/utils/mapping-sync-rules";
import type { MappingSyncRuleUpdates } from "../../src/utils/mapping-sync-rules";
import {
  countEffectiveUserMappings,
  createSetDestinationsTransaction,
  createSetSourcesTransaction,
  MAPPING_LIMIT_ERROR_MESSAGE,
  runChangeSourcesForDestination,
  runSetDestinationsForSource,
} from "../../src/utils/source-destination-mappings";

type Database = Awaited<ReturnType<typeof createDatabase>>;

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_calendar_chaining_${process.pid}`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_START = new Date("2031-03-03T00:00:00.000Z");
const WINDOW = {
  timeMax: new Date(WINDOW_START.getTime() + 30 * DAY_MS),
  timeMin: WINDOW_START,
};
const FREE_MAPPING_LIMIT = 3;

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
    sql`INSERT INTO "user" ("id", "email", "name") VALUES (${userId}, ${`${userId}@example.com`}, 'Chain Fixture')`,
  );
  return userId;
};

const seedAccount = async (userId: string): Promise<string> => {
  const [account] = await db()
    .insert(calendarAccountsTable)
    .values({ authType: "oauth", provider: "google", userId })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Account fixture was not inserted");
  }
  return account.id;
};

const seedCalendar = async (userId: string, accountId: string, name: string): Promise<string> => {
  const [calendar] = await db()
    .insert(calendarsTable)
    .values({ accountId, calendarType: "oauth", capabilities: ["pull", "push"], name, userId })
    .returning({ id: calendarsTable.id });
  if (!calendar) {
    throw new Error("Calendar fixture was not inserted");
  }
  return calendar.id;
};

interface EventSeed {
  isAllDay?: boolean;
  startOffsetHours: number;
  title: string;
}

const seedEvent = async (calendarId: string, seed: EventSeed): Promise<string> => {
  const startTime = new Date(WINDOW_START.getTime() + seed.startOffsetHours * HOUR_MS);
  const [event] = await db()
    .insert(eventStatesTable)
    .values({
      availability: "busy",
      calendarId,
      description: `${seed.title} description`,
      endTime: new Date(startTime.getTime() + HOUR_MS),
      isAllDay: seed.isAllDay ?? false,
      location: `${seed.title} location`,
      sourceEventType: "default",
      sourceEventUid: `${seed.title}@fixture`,
      startTime,
      title: seed.title,
    })
    .returning({ id: eventStatesTable.id });
  if (!event) {
    throw new Error("Event fixture was not inserted");
  }
  return event.id;
};

const link = async (userId: string, sourceId: string, destinationIds: string[]): Promise<void> => {
  await runSetDestinationsForSource(userId, sourceId, destinationIds, {
    withTransaction: (callback) =>
      db().transaction((transaction) =>
        callback(createSetDestinationsTransaction(transaction))),
  });
};

const updateLink = (
  userId: string,
  sourceId: string,
  destinationId: string,
  updates: MappingSyncRuleUpdates,
) => writeMappingSyncRuleOverrides(db(), userId, sourceId, destinationId, updates);

const optIn = (userId: string, sourceId: string, destinationId: string) =>
  updateLink(userId, sourceId, destinationId, { includeUpstreamSources: true });

const overrideRules = (
  userId: string,
  sourceId: string,
  destinationId: string,
  overrides: Partial<SyncRuleOverrides>,
) => updateLink(userId, sourceId, destinationId, overrides);

const readDestinationSummaries = async (destinationId: string): Promise<string[]> => {
  const events = await getEventsForDestination(db(), destinationId, WINDOW);
  return events.map((event) => event.summary).toSorted();
};

const readSourceIds = async (destinationId: string): Promise<string[]> => {
  const sources = await getEffectiveSourcesForDestination(db(), destinationId);
  return sources.map((source) => source.sourceCalendarId);
};

const showEventNames = { excludeEventName: false } as const;

interface Family {
  accountId: string;
  aubreyId: string;
  kidsId: string;
  secretopId: string;
  userId: string;
}

const AUBREY = "Aubrey's Schedule";
const KIDS = "Kids Schedules";

const seedFamily = async (): Promise<Family> => {
  const userId = await seedUser();
  const accountId = await seedAccount(userId);
  const aubreyId = await seedCalendar(userId, accountId, AUBREY);
  const kidsId = await seedCalendar(userId, accountId, KIDS);
  const secretopId = await seedCalendar(userId, accountId, "secretop@gmail.com");

  await seedEvent(aubreyId, { startOffsetHours: 10, title: "Swim meet" });
  await seedEvent(kidsId, { startOffsetHours: 34, title: "School play" });

  await link(userId, aubreyId, [kidsId]);
  await link(userId, kidsId, [secretopId]);
  await overrideRules(userId, aubreyId, kidsId, showEventNames);
  await overrideRules(userId, kidsId, secretopId, showEventNames);
  return { accountId, aubreyId, kidsId, secretopId, userId };
};

describe.skipIf(!administrativeUrl)("calendar chaining", () => {
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

  describe("opting in", () => {
    it("creates links that do not include upstream sources", async () => {
      const family = await seedFamily();

      const mappings = await db()
        .select({ includeUpstreamSources: sourceDestinationMappingsTable.includeUpstreamSources })
        .from(sourceDestinationMappingsTable)
        .where(eq(sourceDestinationMappingsTable.destinationCalendarId, family.secretopId));

      expect(mappings).toEqual([{ includeUpstreamSources: false }]);
    });

    it("syncs a chain exactly as before while no link has opted in", async () => {
      const family = await seedFamily();

      expect(await readDestinationSummaries(family.secretopId)).toEqual(["School play"]);
      expect(await readDestinationSummaries(family.kidsId)).toEqual(["Swim meet"]);
    });

    it("can be turned off again", async () => {
      const family = await seedFamily();
      await optIn(family.userId, family.kidsId, family.secretopId);

      await updateLink(family.userId, family.kidsId, family.secretopId, {
        includeUpstreamSources: false,
      });

      expect(await readDestinationSummaries(family.secretopId)).toEqual(["School play"]);
    });
  });

  describe("chains", () => {
    it("delivers a two-hop chain to the final calendar", async () => {
      const family = await seedFamily();

      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual([
        "School play",
        "Swim meet",
      ]);
    });

    it("delivers a three-hop chain to the final calendar", async () => {
      const family = await seedFamily();
      const archiveId = await seedCalendar(family.userId, family.accountId, "Archive");
      await link(family.userId, family.secretopId, [archiveId]);
      await overrideRules(family.userId, family.secretopId, archiveId, showEventNames);
      await seedEvent(family.secretopId, { startOffsetHours: 58, title: "Date night" });

      await optIn(family.userId, family.kidsId, family.secretopId);
      await optIn(family.userId, family.secretopId, archiveId);

      expect(await readDestinationSummaries(archiveId)).toEqual([
        "Date night",
        "School play",
        "Swim meet",
      ]);
    });

    it("copies an event once when two paths reach the same calendar", async () => {
      const family = await seedFamily();
      const sportsId = await seedCalendar(family.userId, family.accountId, "Sports");
      await link(family.userId, family.aubreyId, [family.kidsId, sportsId]);
      await link(family.userId, sportsId, [family.secretopId]);
      await overrideRules(family.userId, family.aubreyId, sportsId, showEventNames);
      await overrideRules(family.userId, sportsId, family.secretopId, showEventNames);

      await optIn(family.userId, family.kidsId, family.secretopId);
      await optIn(family.userId, sportsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual([
        "School play",
        "Swim meet",
      ]);
    });

    it("terminates on a two-calendar cycle without copying a calendar into itself", async () => {
      const family = await seedFamily();
      await link(family.userId, family.kidsId, [family.secretopId, family.aubreyId]);
      await overrideRules(family.userId, family.kidsId, family.aubreyId, showEventNames);

      await optIn(family.userId, family.aubreyId, family.kidsId);
      await optIn(family.userId, family.kidsId, family.aubreyId);

      expect(await readDestinationSummaries(family.aubreyId)).toEqual(["School play"]);
      expect(await readDestinationSummaries(family.kidsId)).toEqual(["Swim meet"]);
    });

    it("terminates on a three-calendar cycle without copying a calendar into itself", async () => {
      const family = await seedFamily();
      await seedEvent(family.secretopId, { startOffsetHours: 58, title: "Date night" });
      await link(family.userId, family.secretopId, [family.aubreyId]);
      await overrideRules(family.userId, family.secretopId, family.aubreyId, showEventNames);

      await optIn(family.userId, family.aubreyId, family.kidsId);
      await optIn(family.userId, family.kidsId, family.secretopId);
      await optIn(family.userId, family.secretopId, family.aubreyId);

      expect(await readDestinationSummaries(family.aubreyId)).toEqual([
        "Date night",
        "School play",
      ]);
      expect(await readDestinationSummaries(family.kidsId)).toEqual([
        "Date night",
        "Swim meet",
      ]);
      expect(await readDestinationSummaries(family.secretopId)).toEqual([
        "School play",
        "Swim meet",
      ]);
    });

    it("stops inheriting once the middle link is removed", async () => {
      const family = await seedFamily();
      await optIn(family.userId, family.kidsId, family.secretopId);

      await link(family.userId, family.aubreyId, []);

      expect(await readSourceIds(family.secretopId)).toEqual([family.kidsId]);
      expect(await readDestinationSummaries(family.secretopId)).toEqual(["School play"]);
    });

    it("reads inherited events from the original calendar, never from the intermediate one", async () => {
      const family = await seedFamily();
      await optIn(family.userId, family.kidsId, family.secretopId);

      const events = await getEventsForDestination(db(), family.secretopId, WINDOW);
      const inherited = events.find((event) => event.summary === "Swim meet");

      expect(inherited?.calendarId).toBe(family.aubreyId);
      expect(inherited?.sourceEventUid).toBe("Swim meet@fixture");
    });

    it("ignores a link whose source belongs to another account", async () => {
      const family = await seedFamily();
      const strangerId = await seedUser();
      const strangerAccountId = await seedAccount(strangerId);
      const strangerCalendarId = await seedCalendar(strangerId, strangerAccountId, "Stranger");
      await seedEvent(strangerCalendarId, { startOffsetHours: 82, title: "Private dinner" });
      await db().insert(sourceDestinationMappingsTable).values({
        destinationCalendarId: family.kidsId,
        includeUpstreamSources: true,
        sourceCalendarId: strangerCalendarId,
      });

      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readSourceIds(family.secretopId)).not.toContain(strangerCalendarId);
      expect(await readSourceIds(family.kidsId)).toEqual([family.aubreyId]);
    });
  });

  describe("rules along a path", () => {
    it("shows an inherited event the way the intermediate calendar shows it", async () => {
      const family = await seedFamily();
      await overrideRules(family.userId, family.aubreyId, family.kidsId, {
        excludeEventName: true,
      });

      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual([AUBREY, "School play"]);
    });

    it("applies each link's event name in order", async () => {
      const family = await seedFamily();
      await overrideRules(family.userId, family.aubreyId, family.kidsId, {
        customEventName: "Aubrey: {{event_name}}",
        excludeEventName: true,
      });
      await overrideRules(family.userId, family.kidsId, family.secretopId, {
        customEventName: "{{event_name}} ({{calendar_name}})",
        excludeEventName: true,
      });

      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual([
        `Aubrey: Swim meet (${KIDS})`,
        `School play (${KIDS})`,
      ]);
    });

    it("filters an inherited event by the title the intermediate calendar shows", async () => {
      const family = await seedFamily();
      await overrideRules(family.userId, family.kidsId, family.secretopId, {
        excludeTitleKeywords: ["swim"],
      });
      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual(["School play"]);

      await overrideRules(family.userId, family.aubreyId, family.kidsId, {
        excludeEventName: true,
      });

      expect(await readDestinationSummaries(family.secretopId)).toEqual([AUBREY, "School play"]);
    });

    it("never inherits an event the first link filters out", async () => {
      const family = await seedFamily();
      await seedEvent(family.aubreyId, { isAllDay: true, startOffsetHours: 96, title: "Camp" });
      await overrideRules(family.userId, family.aubreyId, family.kidsId, {
        excludeAllDayEvents: true,
      });

      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await readDestinationSummaries(family.secretopId)).toEqual([
        "School play",
        "Swim meet",
      ]);
    });

    it("keeps a detail hidden once any link on the path hides it", async () => {
      const family = await seedFamily();
      await overrideRules(family.userId, family.aubreyId, family.kidsId, {
        excludeEventDescription: false,
        excludeEventLocation: true,
      });
      await overrideRules(family.userId, family.kidsId, family.secretopId, {
        excludeEventDescription: true,
        excludeEventLocation: false,
      });

      await optIn(family.userId, family.kidsId, family.secretopId);
      const events = await getEventsForDestination(db(), family.secretopId, WINDOW);
      const inherited = events.find((event) => event.summary === "Swim meet");
      const own = events.find((event) => event.summary === "School play");

      expect(inherited?.description).toBeUndefined();
      expect(inherited?.location).toBeUndefined();
      expect(own?.location).toBe("School play location");
    });
  });

  describe("upstream changes", () => {
    it("reaches every downstream destination of a source", async () => {
      const family = await seedFamily();
      const archiveId = await seedCalendar(family.userId, family.accountId, "Archive");
      await link(family.userId, family.secretopId, [archiveId]);

      expect(await getEffectiveDestinationIdsForSource(db(), family.aubreyId))
        .toEqual([family.kidsId]);

      await optIn(family.userId, family.kidsId, family.secretopId);
      await optIn(family.userId, family.secretopId, archiveId);

      const downstreamIds = await getEffectiveDestinationIdsForSource(db(), family.aubreyId);

      expect(downstreamIds.toSorted())
        .toEqual([family.kidsId, family.secretopId, archiveId].toSorted());
    });

    it("ingests a source for the range of every destination that inherits it", async () => {
      const family = await seedFamily();
      await db()
        .update(calendarsTable)
        .set({ syncHistoricRange: "12_months" })
        .where(eq(calendarsTable.id, family.secretopId));

      const before = await getEffectiveDestinationRangesForSource(db(), family.aubreyId);
      await optIn(family.userId, family.kidsId, family.secretopId);
      const after = await getEffectiveDestinationRangesForSource(db(), family.aubreyId);

      expect(before.map((ranges) => ranges.syncHistoricRange)).toEqual(["1_month"]);
      expect(after.map((ranges) => ranges.syncHistoricRange).toSorted())
        .toEqual(["12_months", "1_month"]);
    });
  });

  describe("plan limits", () => {
    const freePlan = {
      countEffectiveMappings: countEffectiveUserMappings,
      limitErrorMessage: MAPPING_LIMIT_ERROR_MESSAGE,
      mappingLimit: FREE_MAPPING_LIMIT,
    };

    const addSource = (userId: string, destinationId: string, sourceId: string) =>
      runChangeSourcesForDestination(
        userId,
        destinationId,
        { calendarId: sourceId, enabled: true, kind: "toggle" },
        {
          resolveMappingLimit: () => Promise.resolve(FREE_MAPPING_LIMIT),
          withTransaction: (callback) =>
            db().transaction((transaction) =>
              callback(createSetSourcesTransaction(transaction))),
        },
      );

    const readLink = async (sourceId: string, destinationId: string) => {
      const [row] = await db()
        .select({ includeUpstreamSources: sourceDestinationMappingsTable.includeUpstreamSources })
        .from(sourceDestinationMappingsTable)
        .where(and(
          eq(sourceDestinationMappingsTable.sourceCalendarId, sourceId),
          eq(sourceDestinationMappingsTable.destinationCalendarId, destinationId),
        ));
      return row ?? null;
    };

    it("counts an inherited source as a mapping", async () => {
      const family = await seedFamily();

      expect(await countEffectiveUserMappings(db(), family.userId)).toBe(2);
      await optIn(family.userId, family.kidsId, family.secretopId);

      expect(await countEffectiveUserMappings(db(), family.userId)).toBe(3);
    });

    it("allows opting in while the inherited sources fit the plan", async () => {
      const family = await seedFamily();

      const updated = await writeMappingSyncRuleOverrides(
        db(),
        family.userId,
        family.kidsId,
        family.secretopId,
        { includeUpstreamSources: true },
        freePlan,
      );

      expect(updated?.includeUpstreamSources).toBe(true);
    });

    it("refuses to opt in when the inherited sources would exceed the plan", async () => {
      const family = await seedFamily();
      const sportsId = await seedCalendar(family.userId, family.accountId, "Sports");
      await link(family.userId, sportsId, [family.kidsId]);

      await expect(writeMappingSyncRuleOverrides(
        db(),
        family.userId,
        family.kidsId,
        family.secretopId,
        { includeUpstreamSources: true },
        freePlan,
      )).rejects.toThrow(MAPPING_LIMIT_ERROR_MESSAGE);
      expect(await readLink(family.kidsId, family.secretopId))
        .toEqual({ includeUpstreamSources: false });
    });

    it("refuses a new link whose inherited sources would exceed the plan", async () => {
      const family = await seedFamily();
      const sportsId = await seedCalendar(family.userId, family.accountId, "Sports");
      await optIn(family.userId, family.kidsId, family.secretopId);

      await expect(addSource(family.userId, family.kidsId, sportsId))
        .rejects.toThrow(MAPPING_LIMIT_ERROR_MESSAGE);
      expect(await readLink(sportsId, family.kidsId)).toBeNull();
    });

    it("still allows a third link when nothing is inherited", async () => {
      const family = await seedFamily();
      const sportsId = await seedCalendar(family.userId, family.accountId, "Sports");

      await addSource(family.userId, family.kidsId, sportsId);

      expect(await readLink(sportsId, family.kidsId)).toEqual({ includeUpstreamSources: false });
    });
  });

  describe("copied events", () => {
    const recordInheritedCopy = async (family: Family): Promise<void> => {
      const [swimMeet] = await db()
        .select({ id: eventStatesTable.id })
        .from(eventStatesTable)
        .where(eq(eventStatesTable.calendarId, family.aubreyId));
      const startTime = new Date(Date.now() + DAY_MS).toISOString();
      const endTime = new Date(Date.now() + DAY_MS + HOUR_MS).toISOString();
      await db().execute(sql`
        INSERT INTO "event_mappings"
          ("calendarId", "sourceCalendarId", "eventStateId", "syncEventId", "destinationEventUid", "startTime", "endTime")
        VALUES (
          ${family.secretopId}::uuid, ${family.aubreyId}::uuid, ${swimMeet?.id}::uuid,
          ${swimMeet?.id}, ${`copy-${crypto.randomUUID()}`}, ${startTime}::timestamptz, ${endTime}::timestamptz
        )
      `);
    };

    it("counts an inherited copy and names the calendar it came through", async () => {
      const family = await seedFamily();
      await recordInheritedCopy(family);

      const beforeOptIn = await getCopiedEvents(db(), family.userId, 4);
      await optIn(family.userId, family.kidsId, family.secretopId);
      const copies = await getCopiedEvents(db(), family.userId, 4);

      expect(beforeOptIn.count).toBe(0);
      expect(copies.count).toBe(1);
      expect(copies.upcoming).toMatchObject([{
        destinationCalendarId: family.secretopId,
        sourceCalendarId: family.aubreyId,
        viaCalendarIds: [family.kidsId],
      }]);
    });
  });
});
