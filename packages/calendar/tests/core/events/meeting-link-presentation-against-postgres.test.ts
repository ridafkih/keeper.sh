import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { applySourceSyncDefaults } from "@keeper.sh/data-schemas";
import { getEventsForCalendarsWithDiagnostics } from "../../../src/core/events/events";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import { formatMeetingLinkLine } from "../../../src/core/events/meeting-link";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../database/scripts/migrate.ts`;
const databaseName = `keeper_calendar_meeting_links_${process.pid}`;

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_START = new Date("2031-03-03T00:00:00.000Z");
const WINDOW = {
  timeMax: new Date(WINDOW_START.getTime() + 30 * 24 * HOUR_MS),
  timeMin: WINDOW_START,
};
const MEET_LINK = "https://meet.google.com/abc-defg-hij";
const DESCRIPTION = "Agenda";

type Database = Awaited<ReturnType<typeof createDatabase>>;

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeClient = async (run: (client: SQL) => Promise<void>): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "");
  try {
    await run(client);
  } finally {
    await client.close();
  }
};

interface World {
  destinationId: string;
  sourceId: string;
}

interface SourceSettings {
  excludeEventDescription: boolean;
  excludeEventMeetingLink?: boolean;
}

describe.skipIf(!administrativeUrl)("meeting links on copied events", () => {
  let database: Database | null = null;

  const db = (): Database => {
    if (!database) {
      throw new Error("database not ready");
    }
    return database;
  };

  const seedWorld = async (settings: SourceSettings, meetingLink: string | null): Promise<World> => {
    const userId = `user-${crypto.randomUUID()}`;
    await db().execute(
      sql`INSERT INTO "user" ("id", "email", "name") VALUES (${userId}, ${`${userId}@example.com`}, 'Owner')`,
    );
    const [account] = await db()
      .insert(calendarAccountsTable)
      .values({ authType: "oauth", provider: "google", userId })
      .returning({ id: calendarAccountsTable.id });
    if (!account) {
      throw new Error("Account fixture was not inserted");
    }
    const [source] = await db()
      .insert(calendarsTable)
      .values({
        accountId: account.id,
        calendarType: "oauth",
        capabilities: ["pull"],
        name: "Work",
        userId,
        ...settings,
      })
      .returning({ id: calendarsTable.id });
    const [destination] = await db()
      .insert(calendarsTable)
      .values({
        accountId: account.id,
        calendarType: "oauth",
        capabilities: ["pull", "push"],
        name: "Personal",
        userId,
      })
      .returning({ id: calendarsTable.id });
    if (!source || !destination) {
      throw new Error("Calendar fixtures were not inserted");
    }
    await db().insert(eventStatesTable).values({
      availability: "busy",
      calendarId: source.id,
      description: DESCRIPTION,
      endTime: new Date(WINDOW_START.getTime() + 11 * HOUR_MS),
      meetingLink,
      sourceEventId: "google-event",
      sourceEventType: "default",
      sourceEventUid: "meeting@google.com",
      startTime: new Date(WINDOW_START.getTime() + 10 * HOUR_MS),
      title: "Standup",
    });
    await db().insert(sourceDestinationMappingsTable).values({
      destinationCalendarId: destination.id,
      sourceCalendarId: source.id,
    });
    return { destinationId: destination.id, sourceId: source.id };
  };

  const readCopy = async (world: World) => {
    const read = await getEventsForCalendarsWithDiagnostics(
      db(),
      [world.sourceId],
      WINDOW,
      { destinationCalendarId: world.destinationId },
    );
    const [event] = read.events;
    if (!event) {
      throw new Error("The copied event was not read");
    }
    return event;
  };

  const readCopiedDescription = async (world: World): Promise<string | undefined> => {
    const event = await readCopy(world);
    return event.description;
  };

  const hashOf = (event: Awaited<ReturnType<typeof readCopy>>): string =>
    createSyncEventContentHash(event);

  beforeAll(async () => {
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    });
    const migrated = await Bun.$`bun ${migrationScript}`
      .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
      .quiet()
      .nothrow();
    if (migrated.exitCode !== 0) {
      throw new Error(`Migration failed: ${migrated.stderr.toString()}`);
    }
    database = await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 2 });
  }, 300_000);

  afterAll(async () => {
    if (database) {
      closeDatabase(database, { graceSeconds: 1 });
    }
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  it("leaves meeting links off a calendar that never chose the setting", async () => {
    const world = await seedWorld({ excludeEventDescription: false }, MEET_LINK);

    expect(await readCopiedDescription(world)).toBe(DESCRIPTION);
  });

  it("turns meeting links on for a calendar created with the source defaults", () => {
    expect(applySourceSyncDefaults({}).excludeEventMeetingLink).toBe(false);
  });

  it("keeps the content hash unchanged while the setting is off", async () => {
    const withLink = await seedWorld({ excludeEventDescription: false, excludeEventMeetingLink: true }, MEET_LINK);
    const withoutLink = await seedWorld({ excludeEventDescription: false, excludeEventMeetingLink: true }, null);

    expect(hashOf(await readCopy(withLink))).toBe(hashOf(await readCopy(withoutLink)));
  });

  it("appends the link line to the description when the setting is on", async () => {
    const world = await seedWorld({ excludeEventDescription: false, excludeEventMeetingLink: false }, MEET_LINK);

    expect(await readCopiedDescription(world))
      .toBe(`${DESCRIPTION}\n\n${formatMeetingLinkLine(MEET_LINK)}`);
  });

  it("copies only the link line when descriptions are off", async () => {
    const world = await seedWorld({ excludeEventDescription: true, excludeEventMeetingLink: false }, MEET_LINK);

    expect(await readCopiedDescription(world)).toBe(formatMeetingLinkLine(MEET_LINK));
  });

  it("copies the description without the link when only the link is off", async () => {
    const world = await seedWorld({ excludeEventDescription: false, excludeEventMeetingLink: true }, MEET_LINK);

    expect(await readCopiedDescription(world)).toBe(DESCRIPTION);
  });

  it("changes the content hash when the setting is turned on", async () => {
    const world = await seedWorld({ excludeEventDescription: false, excludeEventMeetingLink: true }, MEET_LINK);
    const before = hashOf(await readCopy(world));

    await db()
      .update(calendarsTable)
      .set({ excludeEventMeetingLink: false })
      .where(eq(calendarsTable.id, world.sourceId));

    expect(hashOf(await readCopy(world))).not.toBe(before);
  });

  it("follows a destination's override over the source calendar's setting", async () => {
    const world = await seedWorld({ excludeEventDescription: true, excludeEventMeetingLink: true }, MEET_LINK);

    await db()
      .update(sourceDestinationMappingsTable)
      .set({ excludeEventMeetingLink: false })
      .where(eq(sourceDestinationMappingsTable.sourceCalendarId, world.sourceId));

    expect(await readCopiedDescription(world)).toBe(formatMeetingLinkLine(MEET_LINK));
  });
});
