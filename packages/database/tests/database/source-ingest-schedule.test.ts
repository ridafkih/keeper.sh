import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  claimIngests,
  completeIngests,
  hasSiblingReadSinceLastSuccess,
  readIngestScheduleHealth,
  wakeIngests,
  wakeUserIngests,
} from "../../src/database/ingest-schedule";
import type { ClaimedIngest, IngestCompletion } from "../../src/database/ingest-schedule";
import { closeDatabase, createDatabase } from "../../src/utils/database";
import type { DatabaseInstance } from "../../src/utils/database";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const templateName = `keeper_ingest_schedule_template_${process.pid}`;
const scratchNames: string[] = [];

const MINUTE_MS = 60_000;
const LEASE_MS = 5 * MINUTE_MS;

const buildDatabaseUrl = (databaseName: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const withAdministrativeClient = async <Result>(
  run: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ connectionString: administrativeUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const runMigrations = async (databaseName: string): Promise<void> => {
  const result = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Migration failed for ${databaseName}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
};

interface Scratch {
  client: Client;
  database: DatabaseInstance;
}

const withScratch = async (label: string, run: (scratch: Scratch) => Promise<void>): Promise<void> => {
  const name = `keeper_ingest_schedule_${label}_${process.pid}`;
  scratchNames.push(name);
  await withAdministrativeClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  const client = new Client({ connectionString: buildDatabaseUrl(name) });
  await client.connect();
  const database = await createDatabase(buildDatabaseUrl(name), { maxConnections: 4 });
  try {
    await run({ client, database });
  } finally {
    closeDatabase(database, { graceSeconds: 1 });
    await client.end();
  }
};

const seedUser = async (client: Client, userId: string): Promise<void> => {
  await client.query(
    `INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, $3)`,
    [userId, `${userId}@example.com`, "Schedule Fixture"],
  );
};

const seedCredential = async (client: Client, userId: string): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "oauth_credentials" ("accessToken", "expiresAt", "provider", "refreshToken", "userId")
     VALUES ('access', now() + interval '1 hour', 'google', 'refresh-1', $1) RETURNING "id"`,
    [userId],
  );
  return result.rows[0]?.id ?? "";
};

const seedAccount = async (
  client: Client,
  userId: string,
  oauthCredentialId: string | null = null,
): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "oauthCredentialId")
     VALUES ('oauth', 'google', $1, $2) RETURNING "id"`,
    [userId, oauthCredentialId],
  );
  return result.rows[0]?.id ?? "";
};

interface CalendarSeed {
  accountId: string;
  capabilities?: string[];
  disabled?: boolean;
  userId: string;
}

const seedCalendar = async (client: Client, seed: CalendarSeed): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId", "capabilities", "disabled")
     VALUES ($1, 'oauth', 'Fixture', $2, $3, $4) RETURNING "id"`,
    [seed.accountId, seed.userId, seed.capabilities ?? ["pull", "push"], seed.disabled ?? false],
  );
  return result.rows[0]?.id ?? "";
};

interface ScheduleRow {
  dueInMs: number | null;
  failureCount: number;
  leaseToken: string | null;
  parkedReason: string | null;
  wakeDueInMs: number | null;
  wakeSeq: number;
}

const readSchedule = async (client: Client, calendarId: string): Promise<ScheduleRow | null> => {
  const result = await client.query<ScheduleRow>(
    `SELECT
       (extract(epoch from ("dueAt" - now())) * 1000)::float8 AS "dueInMs",
       "failureCount",
       "leaseToken",
       "parkedReason",
       (extract(epoch from ("wakeDueAt" - now())) * 1000)::float8 AS "wakeDueInMs",
       "wakeSeq"
     FROM "source_ingest_schedule" WHERE "calendarId" = $1`,
    [calendarId],
  );
  const [row = null] = result.rows;
  return row;
};

const setDue = async (client: Client, calendarId: string, offsetMs: number): Promise<void> => {
  await client.query(
    `UPDATE "source_ingest_schedule"
     SET "dueAt" = now() + ($2 * interval '1 millisecond'), "parkedReason" = NULL
     WHERE "calendarId" = $1`,
    [calendarId, offsetMs],
  );
};

const completion = (
  claimed: ClaimedIngest,
  overrides: Partial<IngestCompletion> = {},
): IngestCompletion => ({
  attempted: true,
  calendarId: claimed.calendarId,
  claimedReleaseSeq: claimed.releaseSeq,
  claimedWakeSeq: claimed.wakeSeq,
  failed: false,
  failureCount: 0,
  leaseToken: claimed.leaseToken,
  nextDueInMs: 10 * MINUTE_MS,
  parkedReason: null,
  succeeded: true,
  ...overrides,
});

const claimFleet = (database: DatabaseInstance, limit: number, leaseMs = LEASE_MS) =>
  claimIngests(database, { lane: "fleet", leaseMs, leaseToken: crypto.randomUUID(), limit });

const claimWake = (database: DatabaseInstance, limit: number, leaseMs = LEASE_MS) =>
  claimIngests(database, { lane: "wake", leaseMs, leaseToken: crypto.randomUUID(), limit });

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

describe.skipIf(!administrativeUrl)("source ingest schedule", () => {
  beforeAll(async () => {
    await withAdministrativeClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${templateName}"`);
      await client.query(`CREATE DATABASE "${templateName}"`);
    });
    await runMigrations(templateName);
  }, 300_000);

  afterAll(async () => {
    await withAdministrativeClient(async (client) => {
      for (const name of [...scratchNames, templateName]) {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    });
  }, 120_000);

  describe("triggers keep the schedule in step with calendars", () => {
    it("makes a new pull calendar due immediately and parks one that cannot be read", async () => {
      await withScratch("insert", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const pullCalendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        const pushOnlyCalendarId = await seedCalendar(client, {
          accountId,
          capabilities: ["push"],
          userId: "user-a",
        });
        const disabledCalendarId = await seedCalendar(client, {
          accountId,
          disabled: true,
          userId: "user-a",
        });

        const pull = await readSchedule(client, pullCalendarId);
        expect(pull?.parkedReason).toBeNull();
        expect(pull?.dueInMs).toBeLessThanOrEqual(0);
        expect(await readSchedule(client, pushOnlyCalendarId)).toMatchObject({
          dueInMs: null,
          parkedReason: "ineligible",
        });
        expect(await readSchedule(client, disabledCalendarId)).toMatchObject({
          dueInMs: null,
          parkedReason: "ineligible",
        });
      });
    });

    it("parks a calendar when it is disabled and makes it due again when re-enabled", async () => {
      await withScratch("eligibility", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await setDue(client, calendarId, 30 * MINUTE_MS);

        await client.query(`UPDATE "calendars" SET "disabled" = true WHERE "id" = $1`, [calendarId]);
        expect(await readSchedule(client, calendarId)).toMatchObject({
          dueInMs: null,
          parkedReason: "ineligible",
        });

        await client.query(`UPDATE "calendars" SET "disabled" = false WHERE "id" = $1`, [calendarId]);
        const reenabled = await readSchedule(client, calendarId);
        expect(reenabled?.parkedReason).toBeNull();
        expect(reenabled?.dueInMs).toBeLessThanOrEqual(0);
      });
    });

    it("leaves the schedule alone when an unrelated calendar column changes", async () => {
      await withScratch("unrelated", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await setDue(client, calendarId, 30 * MINUTE_MS);

        await client.query(`UPDATE "calendars" SET "name" = 'Renamed' WHERE "id" = $1`, [calendarId]);
        await client.query(
          `UPDATE "calendars" SET "capabilities" = ARRAY['pull', 'push'] WHERE "id" = $1`,
          [calendarId],
        );

        const untouched = await readSchedule(client, calendarId);
        expect(untouched?.dueInMs).toBeGreaterThan(25 * MINUTE_MS);
      });
    });

    it("releases credential-rejected calendars when the account is reconnected", async () => {
      await withScratch("reauth", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const otherAccountId = await seedAccount(client, "user-a");
        const rejectedCalendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        const otherCalendarId = await seedCalendar(client, {
          accountId: otherAccountId,
          userId: "user-a",
        });
        for (const calendarId of [rejectedCalendarId, otherCalendarId]) {
          await client.query(
            `UPDATE "source_ingest_schedule"
             SET "dueAt" = now() + interval '1 day', "parkedReason" = 'credential-rejected', "failureCount" = 3
             WHERE "calendarId" = $1`,
            [calendarId],
          );
        }
        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = true WHERE "id" = ANY($1)`,
          [[accountId, otherAccountId]],
        );

        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = false WHERE "id" = $1`,
          [accountId],
        );

        const released = await readSchedule(client, rejectedCalendarId);
        expect(released).toMatchObject({ failureCount: 0, parkedReason: null });
        expect(released?.dueInMs).toBeLessThanOrEqual(0);
        expect(await readSchedule(client, otherCalendarId)).toMatchObject({
          parkedReason: "credential-rejected",
        });
      });
    });

    it("releases credential-rejected calendars when the credential is reissued", async () => {
      await withScratch("reissue", async ({ client }) => {
        await seedUser(client, "user-a");
        const credentialId = await seedCredential(client, "user-a");
        const accountId = await seedAccount(client, "user-a", credentialId);
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await client.query(
          `UPDATE "source_ingest_schedule"
           SET "dueAt" = now() + interval '1 day', "parkedReason" = 'credential-rejected'
           WHERE "calendarId" = $1`,
          [calendarId],
        );

        await client.query(
          `UPDATE "oauth_credentials" SET "accessToken" = 'rotated' WHERE "id" = $1`,
          [credentialId],
        );
        expect(await readSchedule(client, calendarId)).toMatchObject({
          parkedReason: "credential-rejected",
        });

        await client.query(
          `UPDATE "oauth_credentials" SET "refreshToken" = 'refresh-2' WHERE "id" = $1`,
          [credentialId],
        );
        const released = await readSchedule(client, calendarId);
        expect(released?.parkedReason).toBeNull();
        expect(released?.dueInMs).toBeLessThanOrEqual(0);
      });
    });

    it("releases calendars that were backing off when the account is reconnected", async () => {
      await withScratch("reauth_backoff", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const backingOffId = await seedCalendar(client, { accountId, userId: "user-a" });
        const healthyId = await seedCalendar(client, { accountId, userId: "user-a" });
        await client.query(
          `UPDATE "source_ingest_schedule" SET "dueAt" = now() + interval '6 hours', "failureCount" = 5
           WHERE "calendarId" = $1`,
          [backingOffId],
        );
        await setDue(client, healthyId, 30 * MINUTE_MS);
        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = true WHERE "id" = $1`,
          [accountId],
        );

        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = false WHERE "id" = $1`,
          [accountId],
        );

        const released = await readSchedule(client, backingOffId);
        expect(released?.failureCount).toBe(0);
        expect(released?.dueInMs).toBeLessThanOrEqual(0);
        const untouched = await readSchedule(client, healthyId);
        expect(untouched?.dueInMs).toBeGreaterThan(25 * MINUTE_MS);
      });
    });

    it("releases a CalDAV account's failing calendars when its credentials change", async () => {
      await withScratch("caldav_credentials", async ({ client }) => {
        await seedUser(client, "user-a");
        const credential = await client.query<{ id: string }>(
          `INSERT INTO "caldav_credentials" ("encryptedPassword", "serverUrl", "username")
           VALUES ('old-cipher', 'https://dav.example.com/', 'dav-user') RETURNING "id"`,
        );
        const credentialId = credential.rows[0]?.id;
        const account = await client.query<{ id: string }>(
          `INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "caldavCredentialId")
           VALUES ('caldav', 'caldav', 'user-a', $1) RETURNING "id"`,
          [credentialId],
        );
        const calendarId = await seedCalendar(client, {
          accountId: account.rows[0]?.id ?? "",
          userId: "user-a",
        });
        await client.query(
          `UPDATE "source_ingest_schedule" SET "dueAt" = now() + interval '6 hours', "failureCount" = 4
           WHERE "calendarId" = $1`,
          [calendarId],
        );

        await client.query(
          `UPDATE "caldav_credentials" SET "username" = 'dav-user' WHERE "id" = $1`,
          [credentialId],
        );
        expect(await readSchedule(client, calendarId)).toMatchObject({ failureCount: 4 });

        await client.query(
          `UPDATE "caldav_credentials" SET "encryptedPassword" = 'new-cipher' WHERE "id" = $1`,
          [credentialId],
        );
        const released = await readSchedule(client, calendarId);
        expect(released?.failureCount).toBe(0);
        expect(released?.dueInMs).toBeLessThanOrEqual(0);
      });
    });

    it("leaves a backing-off calendar alone when its OAuth refresh token rotates", async () => {
      await withScratch("rotation", async ({ client }) => {
        await seedUser(client, "user-a");
        const credentialId = await seedCredential(client, "user-a");
        const accountId = await seedAccount(client, "user-a", credentialId);
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await client.query(
          `UPDATE "source_ingest_schedule" SET "dueAt" = now() + interval '2 hours', "failureCount" = 5
           WHERE "calendarId" = $1`,
          [calendarId],
        );

        await client.query(
          `UPDATE "oauth_credentials" SET "refreshToken" = 'rotated-refresh' WHERE "id" = $1`,
          [credentialId],
        );

        const untouched = await readSchedule(client, calendarId);
        expect(untouched?.failureCount).toBe(5);
        expect(untouched?.dueInMs).toBeGreaterThan(MINUTE_MS * 100);
      });
    });

    it("wakes a user's calendars when they sign in, and nobody else's", async () => {
      await withScratch("sign_in", async ({ client }) => {
        await seedUser(client, "user-a");
        await seedUser(client, "user-b");
        const accountA = await seedAccount(client, "user-a");
        const accountB = await seedAccount(client, "user-b");
        const calendarA = await seedCalendar(client, { accountId: accountA, userId: "user-a" });
        const calendarB = await seedCalendar(client, { accountId: accountB, userId: "user-b" });
        await setDue(client, calendarA, 24 * 60 * MINUTE_MS);
        await setDue(client, calendarB, 24 * 60 * MINUTE_MS);

        await client.query(
          `INSERT INTO "session" ("id", "token", "userId", "expiresAt")
           VALUES ('session-a', 'token-a', 'user-a', now() + interval '1 day')`,
        );

        const woken = await readSchedule(client, calendarA);
        expect(woken?.wakeSeq).toBe(1);
        expect(woken?.wakeDueInMs).toBeLessThanOrEqual(0);
        expect(await readSchedule(client, calendarB)).toMatchObject({
          wakeDueInMs: null,
          wakeSeq: 0,
        });
      });
    });

    it("wakes a source when it is mapped and a calendar when it is published to a feed", async () => {
      await withScratch("intent", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const sourceId = await seedCalendar(client, { accountId, userId: "user-a" });
        const destinationId = await seedCalendar(client, { accountId, userId: "user-a" });
        const publishedId = await seedCalendar(client, { accountId, userId: "user-a" });
        for (const calendarId of [sourceId, destinationId, publishedId]) {
          await setDue(client, calendarId, 24 * 60 * MINUTE_MS);
        }

        await client.query(
          `INSERT INTO "source_destination_mappings" ("sourceCalendarId", "destinationCalendarId")
           VALUES ($1, $2)`,
          [sourceId, destinationId],
        );
        const feed = await client.query<{ id: string }>(
          `INSERT INTO "ical_feeds" ("userId", "token", "name")
           VALUES ('user-a', 'feed-token', 'Feed') RETURNING "id"`,
        );
        await client.query(
          `INSERT INTO "ical_feed_calendars" ("feedId", "calendarId") VALUES ($1, $2)`,
          [feed.rows[0]?.id, publishedId],
        );

        expect(await readSchedule(client, sourceId)).toMatchObject({ wakeSeq: 1 });
        expect(await readSchedule(client, destinationId)).toMatchObject({ wakeSeq: 0 });
        expect(await readSchedule(client, publishedId)).toMatchObject({ wakeSeq: 1 });
      });
    });

    it("removes the schedule row with its calendar", async () => {
      await withScratch("cascade", async ({ client }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });

        await client.query(`DELETE FROM "calendars" WHERE "id" = $1`, [calendarId]);

        expect(await readSchedule(client, calendarId)).toBeNull();
      });
    });
  });

  describe("claims", () => {
    it("takes only due calendars, oldest first, up to the limit, and leases them", async () => {
      await withScratch("claim_order", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const oldest = await seedCalendar(client, { accountId, userId: "user-a" });
        const middle = await seedCalendar(client, { accountId, userId: "user-a" });
        const newest = await seedCalendar(client, { accountId, userId: "user-a" });
        const future = await seedCalendar(client, { accountId, userId: "user-a" });
        await setDue(client, oldest, -30 * MINUTE_MS);
        await setDue(client, middle, -20 * MINUTE_MS);
        await setDue(client, newest, -10 * MINUTE_MS);
        await setDue(client, future, 10 * MINUTE_MS);

        const claimed = await claimFleet(database, 2);

        expect(claimed.map(({ calendarId }) => calendarId)).toEqual([oldest, middle]);
        expect(claimed[0]?.userId).toBe("user-a");
        expect(claimed[0]?.lagMs).toBeGreaterThanOrEqual(30 * MINUTE_MS - 1000);
        const leased = await readSchedule(client, oldest);
        expect(leased?.leaseToken).toBe(claimed[0]?.leaseToken);
        expect(leased?.dueInMs).toBeGreaterThan(LEASE_MS - 5000);

        const next = await claimFleet(database, 10);
        expect(next.map(({ calendarId }) => calendarId)).toEqual([newest]);
      });
    });

    it("never hands the same calendar to two concurrent claimers", async () => {
      await withScratch("claim_race", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarIds: string[] = [];
        for (let index = 0; index < 120; index++) {
          calendarIds.push(await seedCalendar(client, { accountId, userId: "user-a" }));
        }

        const claims = await Promise.all(
          Array.from({ length: 6 }, () => claimFleet(database, 30)),
        );

        const claimedIds = claims.flat().map(({ calendarId }) => calendarId);
        expect(new Set(claimedIds).size).toBe(claimedIds.length);
        expect(claimedIds).toHaveLength(calendarIds.length);
      });
    });

    it("makes a calendar due again when its lease lapses, and drops the stale holder's write", async () => {
      await withScratch("lease_lapse", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });

        const [stale] = await claimFleet(database, 1, 200);
        expect(await claimFleet(database, 1)).toHaveLength(0);
        await sleep(400);
        const [current] = await claimFleet(database, 1);
        expect(current?.calendarId).toBe(calendarId);

        if (!stale || !current) {
          throw new Error("Expected both claims");
        }
        expect(await completeIngests(database, [completion(stale, { nextDueInMs: 1000 })]))
          .toEqual([]);
        expect(await completeIngests(database, [completion(current)])).toEqual([calendarId]);
        const row = await readSchedule(client, calendarId);
        expect(row?.leaseToken).toBeNull();
        expect(row?.dueInMs).toBeGreaterThan(9 * MINUTE_MS);
      });
    });
  });

  describe("resets during a read", () => {
    it("never hands a calendar to a second reader when a trigger makes it due mid-read", async () => {
      await withScratch("reset_midflight", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await client.query(
          `UPDATE "source_ingest_schedule" SET "failureCount" = 3 WHERE "calendarId" = $1`,
          [calendarId],
        );
        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = true WHERE "id" = $1`,
          [accountId],
        );
        const [claimed] = await claimFleet(database, 1);
        if (!claimed) {
          throw new Error("Expected a fleet claim");
        }

        await client.query(
          `UPDATE "calendar_accounts" SET "needsReauthentication" = false WHERE "id" = $1`,
          [accountId],
        );
        expect(await claimFleet(database, 1)).toHaveLength(0);

        await completeIngests(database, [completion(claimed, {
          failed: true,
          failureCount: 4,
          nextDueInMs: 24 * 60 * MINUTE_MS,
          parkedReason: "credential-rejected",
          succeeded: false,
        })]);

        const reset = await readSchedule(client, calendarId);
        expect(reset).toMatchObject({ failureCount: 0, leaseToken: null, parkedReason: null });
        expect(reset?.dueInMs).toBeLessThanOrEqual(0);
        expect(await claimFleet(database, 1)).toHaveLength(1);
      });
    });
  });

  describe("completions", () => {
    it("records the next due time, failure state and parking", async () => {
      await withScratch("complete", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const succeededId = await seedCalendar(client, { accountId, userId: "user-a" });
        const failedId = await seedCalendar(client, { accountId, userId: "user-a" });
        const rejectedId = await seedCalendar(client, { accountId, userId: "user-a" });

        const claimed = await claimFleet(database, 3);
        const byId = new Map(claimed.map((claim) => [claim.calendarId, claim]));
        const take = (calendarId: string): ClaimedIngest => {
          const claim = byId.get(calendarId);
          if (!claim) {
            throw new Error(`Missing claim for ${calendarId}`);
          }
          return claim;
        };

        await completeIngests(database, [
          completion(take(succeededId)),
          completion(take(failedId), {
            failed: true,
            failureCount: 2,
            nextDueInMs: 20 * MINUTE_MS,
            succeeded: false,
          }),
          completion(take(rejectedId), {
            failed: true,
            nextDueInMs: 24 * 60 * MINUTE_MS,
            parkedReason: "credential-rejected",
            succeeded: false,
          }),
        ]);

        expect(await readSchedule(client, succeededId)).toMatchObject({
          failureCount: 0,
          leaseToken: null,
          parkedReason: null,
        });
        const failed = await readSchedule(client, failedId);
        expect(failed?.failureCount).toBe(2);
        expect(failed?.dueInMs).toBeGreaterThan(19 * MINUTE_MS);
        expect(await readSchedule(client, rejectedId)).toMatchObject({
          parkedReason: "credential-rejected",
        });
      });
    });

    it("keeps a calendar parked when it was disabled while being read", async () => {
      await withScratch("disabled_midflight", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        const [claim] = await claimFleet(database, 1);
        if (!claim) {
          throw new Error("Expected a claim");
        }

        await client.query(`UPDATE "calendars" SET "disabled" = true WHERE "id" = $1`, [calendarId]);
        await completeIngests(database, [completion(claim)]);

        expect(await readSchedule(client, calendarId)).toMatchObject({
          dueInMs: null,
          parkedReason: "ineligible",
        });
      });
    });
  });

  describe("wakes", () => {
    it("debounces a burst of notifications into the earliest deadline", async () => {
      await withScratch("debounce", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await setDue(client, calendarId, 6 * 60 * MINUTE_MS);

        await wakeIngests(database, [calendarId], { correlationId: "first", debounceMs: 5 * MINUTE_MS });
        await wakeIngests(database, [calendarId], { correlationId: "second", debounceMs: 5 * MINUTE_MS });

        const row = await readSchedule(client, calendarId);
        expect(row?.wakeSeq).toBe(2);
        expect(row?.wakeDueInMs).toBeGreaterThan(4 * MINUTE_MS);
        expect(row?.wakeDueInMs).toBeLessThanOrEqual(5 * MINUTE_MS);
        expect(await claimWake(database, 10)).toHaveLength(0);

        await wakeIngests(database, [calendarId], { correlationId: "third", debounceMs: 0 });
        const [claim] = await claimWake(database, 10);
        expect(claim?.calendarId).toBe(calendarId);
        expect(claim?.wakeCorrelationId).toBe("first");
      });
    });

    it("ignores parked calendars", async () => {
      await withScratch("wake_parked", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, disabled: true, userId: "user-a" });

        expect(await wakeIngests(database, [calendarId], { correlationId: null, debounceMs: 0 }))
          .toEqual([]);
        expect(await wakeUserIngests(database, "user-a", { correlationId: null, debounceMs: 0 }))
          .toEqual([]);
      });
    });

    it("reads a calendar again when a notification lands during its read", async () => {
      await withScratch("wake_midflight", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await wakeIngests(database, [calendarId], { correlationId: "before", debounceMs: 0 });
        const [claim] = await claimWake(database, 1);
        if (!claim) {
          throw new Error("Expected a wake claim");
        }

        await wakeIngests(database, [calendarId], { correlationId: "during", debounceMs: 0 });
        expect(await claimWake(database, 1)).toHaveLength(0);
        expect(await claimFleet(database, 1)).toHaveLength(0);

        await completeIngests(database, [completion(claim)]);
        const [again] = await claimWake(database, 1);
        expect(again?.calendarId).toBe(calendarId);
        if (!again) {
          throw new Error("Expected a second wake claim");
        }

        await completeIngests(database, [completion(again)]);
        expect(await readSchedule(client, calendarId)).toMatchObject({ wakeDueInMs: null });
        expect(await claimWake(database, 1)).toHaveLength(0);
      });
    });

    it("lets a fleet read satisfy a wake that was already pending when it was claimed", async () => {
      await withScratch("fleet_consumes_wake", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await wakeIngests(database, [calendarId], { correlationId: null, debounceMs: 60_000 });
        const [claim] = await claimFleet(database, 1);
        if (!claim) {
          throw new Error("Expected a fleet claim");
        }

        await completeIngests(database, [completion(claim)]);

        expect(await readSchedule(client, calendarId)).toMatchObject({ wakeDueInMs: null });
      });
    });

    it("honours backoff, so a failing calendar is not re-read on every notification", async () => {
      await withScratch("wake_backoff", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const failingId = await seedCalendar(client, { accountId, userId: "user-a" });
        const quietId = await seedCalendar(client, { accountId, userId: "user-a" });
        await client.query(
          `UPDATE "source_ingest_schedule" SET "dueAt" = now() + interval '20 minutes', "failureCount" = 2
           WHERE "calendarId" = $1`,
          [failingId],
        );
        await setDue(client, quietId, 6 * 60 * MINUTE_MS);

        await wakeIngests(database, [failingId, quietId], { correlationId: null, debounceMs: 0 });
        const claimed = await claimWake(database, 10);

        expect(claimed.map(({ calendarId }) => calendarId)).toEqual([quietId]);
      });
    });

    it("records a notification that lands during a read as its own receipt", async () => {
      await withScratch("wake_receipt", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await wakeIngests(database, [calendarId], { correlationId: "served", debounceMs: 0 });
        const [claimed] = await claimWake(database, 1);
        if (!claimed) {
          throw new Error("Expected a wake claim");
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        await wakeIngests(database, [calendarId], { correlationId: "pending", debounceMs: 0 });
        await wakeIngests(database, [calendarId], { correlationId: "later", debounceMs: 0 });
        await completeIngests(database, [completion(claimed)]);
        const [again] = await claimWake(database, 1);

        expect(again?.wakeCorrelationId).toBe("pending");
        expect(again?.wakeReceivedAt?.getTime()).toBeGreaterThan(claimed.wakeReceivedAt?.getTime() ?? 0);
      });
    });

    it("holds an unattempted wake back by the retry delay instead of spinning", async () => {
      await withScratch("wake_retry_delay", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await wakeIngests(database, [calendarId], { correlationId: null, debounceMs: 0 });
        const [claimed] = await claimWake(database, 1);
        if (!claimed) {
          throw new Error("Expected a wake claim");
        }

        await completeIngests(database, [completion(claimed, {
          attempted: false,
          nextDueInMs: 30_000,
          succeeded: false,
        })]);

        expect(await claimWake(database, 1)).toHaveLength(0);
        const delayed = await readSchedule(client, calendarId);
        expect(delayed?.wakeDueInMs).toBeGreaterThan(25_000);
      });
    });

    it("keeps the wake when the read never happened", async () => {
      await withScratch("wake_unattempted", async ({ client, database }) => {
        await seedUser(client, "user-a");
        const accountId = await seedAccount(client, "user-a");
        const calendarId = await seedCalendar(client, { accountId, userId: "user-a" });
        await wakeIngests(database, [calendarId], { correlationId: null, debounceMs: 0 });
        const [claim] = await claimWake(database, 1);
        if (!claim) {
          throw new Error("Expected a wake claim");
        }

        await completeIngests(database, [completion(claim, {
          attempted: false,
          nextDueInMs: 15_000,
          succeeded: false,
        })]);

        const kept = await readSchedule(client, calendarId);
        expect(kept?.wakeDueInMs).not.toBeNull();
        expect(kept?.wakeDueInMs).toBeLessThanOrEqual(15_000);
      });
    });
  });

  it("reaches every healthy calendar within one rotation when broken calendars outnumber the batch", async () => {
    await withScratch("starvation", async ({ client, database }) => {
      await seedUser(client, "user-a");
      const accountId = await seedAccount(client, "user-a");
      const brokenIds = new Set<string>();
      const healthyIds = new Set<string>();
      for (let index = 0; index < 60; index++) {
        brokenIds.add(await seedCalendar(client, { accountId, userId: "user-a" }));
      }
      for (let index = 0; index < 140; index++) {
        healthyIds.add(await seedCalendar(client, { accountId, userId: "user-a" }));
      }
      await client.query(
        `UPDATE "source_ingest_schedule" SET "dueAt" = now() - interval '1 day' WHERE "calendarId" = ANY($1)`,
        [[...brokenIds]],
      );

      const batch = 25;
      const read = new Map<string, number>();
      for (let round = 0; round < Math.ceil((brokenIds.size + healthyIds.size) / batch); round++) {
        const claimed = await claimFleet(database, batch);
        for (const { calendarId } of claimed) {
          read.set(calendarId, (read.get(calendarId) ?? 0) + 1);
        }
        await completeIngests(database, claimed.map((claim) => {
          if (brokenIds.has(claim.calendarId)) {
            return completion(claim, {
              failed: true,
              nextDueInMs: 24 * 60 * MINUTE_MS,
              parkedReason: "credential-rejected",
              succeeded: false,
            });
          }
          return completion(claim);
        }));
      }

      for (const calendarId of healthyIds) {
        expect(read.get(calendarId)).toBe(1);
      }
      for (const calendarId of brokenIds) {
        expect(read.get(calendarId)).toBe(1);
      }
      expect(await claimFleet(database, batch)).toHaveLength(0);
    });
  });

  it("tells whether a sibling on the same account has read since a calendar last succeeded", async () => {
    await withScratch("sibling", async ({ client, database }) => {
      await seedUser(client, "user-a");
      const accountId = await seedAccount(client, "user-a");
      const otherAccountId = await seedAccount(client, "user-a");
      const rejectedId = await seedCalendar(client, { accountId, userId: "user-a" });
      const siblingId = await seedCalendar(client, { accountId, userId: "user-a" });
      const strangerId = await seedCalendar(client, { accountId: otherAccountId, userId: "user-a" });
      const setLastSuccess = (calendarId: string, ago: string): Promise<unknown> => client.query(
        `UPDATE "source_ingest_schedule" SET "lastSuccessAt" = now() - $2::interval WHERE "calendarId" = $1`,
        [calendarId, ago],
      );
      await setLastSuccess(strangerId, "1 minute");

      expect(await hasSiblingReadSinceLastSuccess(database, rejectedId)).toBe(false);

      await setLastSuccess(siblingId, "1 hour");
      expect(await hasSiblingReadSinceLastSuccess(database, rejectedId)).toBe(true);

      await setLastSuccess(rejectedId, "10 minutes");
      expect(await hasSiblingReadSinceLastSuccess(database, rejectedId)).toBe(false);

      await setLastSuccess(siblingId, "1 minute");
      expect(await hasSiblingReadSinceLastSuccess(database, rejectedId)).toBe(true);
    });
  });

  it("reports backlog, leases and parked calendars", async () => {
    await withScratch("health", async ({ client, database }) => {
      await seedUser(client, "user-a");
      const accountId = await seedAccount(client, "user-a");
      const overdue = await seedCalendar(client, { accountId, userId: "user-a" });
      const scheduled = await seedCalendar(client, { accountId, userId: "user-a" });
      const rejected = await seedCalendar(client, { accountId, userId: "user-a" });
      await seedCalendar(client, { accountId, disabled: true, userId: "user-a" });
      await setDue(client, overdue, -10 * MINUTE_MS);
      await setDue(client, scheduled, 10 * MINUTE_MS);
      await client.query(
        `UPDATE "source_ingest_schedule"
         SET "dueAt" = now() + interval '1 day', "parkedReason" = 'credential-rejected'
         WHERE "calendarId" = $1`,
        [rejected],
      );

      const health = await readIngestScheduleHealth(database);

      expect(health).toMatchObject({
        credentialRejectedCount: 1,
        dueBacklog: 1,
        ineligibleCount: 1,
        leasedCount: 0,
        scheduledCount: 3,
        unresolvableCount: 0,
        wakeBacklog: 0,
      });
      expect(health.oldestDueLagMs).toBeGreaterThanOrEqual(10 * MINUTE_MS - 1000);
    });
  });
});
