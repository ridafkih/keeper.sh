import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { and, eq } from "drizzle-orm";
import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  caldavCredentialIsUnchanged,
  oauthCredentialIsUnchanged,
} from "../../src/utils/reauthentication-guard";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_reauth_guard_${process.pid}`;
const USER_ID = "guard-user";

const scratchUrl = (): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${scratchName}`;
  return url.toString();
};

const withAdministrativeClient = async (
  statements: string[],
): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "postgres://localhost");
  try {
    for (const statement of statements) {
      await client.unsafe(statement);
    }
  } finally {
    await client.end();
  }
};

let client: SQL = new SQL(administrativeUrl ?? "postgres://localhost");
let database: ReturnType<typeof drizzle> = drizzle(client);

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }

  await withAdministrativeClient([
    `drop database if exists "${scratchName}"`,
    `create database "${scratchName}"`,
  ]);

  const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
  const migration = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: scratchUrl() })
    .quiet()
    .nothrow();
  if (migration.exitCode !== 0) {
    throw new Error(`Migration failed: ${migration.stderr.toString()}`);
  }

  client = new SQL(scratchUrl());
  database = drizzle(client);

  await client.unsafe(`
    insert into "user" (id, email, name) values ('${USER_ID}', 'guard@example.com', 'Guard')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

describe.skipIf(!administrativeUrl)("the reauthentication flag guard against postgres", () => {
  it("flags a CalDAV account whose credential nobody touched during the run", async () => {
    const [credential] = await database
      .insert(caldavCredentialsTable)
      .values({
        encryptedPassword: "encrypted-password",
        serverUrl: "https://caldav.example.com",
        username: "user@example.com",
      })
      .returning({ id: caldavCredentialsTable.id });
    const [account] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "caldav",
        caldavCredentialId: credential?.id,
        provider: "fastmail",
        userId: USER_ID,
      })
      .returning({ id: calendarAccountsTable.id });

    const [observed] = await database
      .select({
        caldavCredentialId: caldavCredentialsTable.id,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
      })
      .from(caldavCredentialsTable)
      .where(eq(caldavCredentialsTable.id, credential?.id ?? ""))
      .limit(1);

    const flagged = await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: true })
      .where(and(
        eq(calendarAccountsTable.id, account?.id ?? ""),
        caldavCredentialIsUnchanged({
          caldavCredentialId: observed?.caldavCredentialId ?? "",
          encryptedPassword: observed?.encryptedPassword ?? "",
        }),
      ))
      .returning({ id: calendarAccountsTable.id });

    expect(flagged).toHaveLength(1);
  });

  it("flags an OAuth account whose refresh token nobody replaced during the run", async () => {
    const [credential] = await database
      .insert(oauthCredentialsTable)
      .values({
        accessToken: "access-token",
        expiresAt: new Date(),
        provider: "google",
        refreshToken: "refresh-token",
        userId: USER_ID,
      })
      .returning({ id: oauthCredentialsTable.id });
    const [account] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "oauth",
        oauthCredentialId: credential?.id,
        provider: "google",
        userId: USER_ID,
      })
      .returning({ id: calendarAccountsTable.id });

    const [observed] = await database
      .select({
        oauthCredentialId: oauthCredentialsTable.id,
        refreshToken: oauthCredentialsTable.refreshToken,
      })
      .from(oauthCredentialsTable)
      .where(eq(oauthCredentialsTable.id, credential?.id ?? ""))
      .limit(1);

    const flagged = await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: true })
      .where(and(
        eq(calendarAccountsTable.id, account?.id ?? ""),
        oauthCredentialIsUnchanged({
          oauthCredentialId: observed?.oauthCredentialId ?? "",
          refreshToken: observed?.refreshToken ?? "",
        }),
      ))
      .returning({ id: calendarAccountsTable.id });

    expect(flagged).toHaveLength(1);
  });

  it("does not flag a CalDAV account whose password was rotated during the run", async () => {
    const [credential] = await database
      .insert(caldavCredentialsTable)
      .values({
        encryptedPassword: "encrypted-password",
        serverUrl: "https://caldav.example.com",
        username: "rotated@example.com",
      })
      .returning({ id: caldavCredentialsTable.id });
    const [account] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "caldav",
        caldavCredentialId: credential?.id,
        provider: "fastmail",
        userId: USER_ID,
      })
      .returning({ id: calendarAccountsTable.id });

    const [observed] = await database
      .select({
        caldavCredentialId: caldavCredentialsTable.id,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
      })
      .from(caldavCredentialsTable)
      .where(eq(caldavCredentialsTable.id, credential?.id ?? ""))
      .limit(1);

    await database
      .update(caldavCredentialsTable)
      .set({ encryptedPassword: "reconnected-password" })
      .where(eq(caldavCredentialsTable.id, credential?.id ?? ""));

    const flagged = await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: true })
      .where(and(
        eq(calendarAccountsTable.id, account?.id ?? ""),
        caldavCredentialIsUnchanged({
          caldavCredentialId: observed?.caldavCredentialId ?? "",
          encryptedPassword: observed?.encryptedPassword ?? "",
        }),
      ))
      .returning({ id: calendarAccountsTable.id });

    expect(flagged).toEqual([]);
  });

  it("still matches the ingest attempt clock it wrote when arming the next backoff", async () => {
    const [credential] = await database
      .insert(caldavCredentialsTable)
      .values({
        encryptedPassword: "encrypted-password",
        serverUrl: "https://caldav.example.com",
        username: "clock@example.com",
      })
      .returning({ id: caldavCredentialsTable.id });
    const [account] = await database
      .insert(calendarAccountsTable)
      .values({
        authType: "caldav",
        caldavCredentialId: credential?.id,
        provider: "fastmail",
        userId: USER_ID,
      })
      .returning({ id: calendarAccountsTable.id });
    const [calendar] = await database
      .insert(calendarsTable)
      .values({
        accountId: account?.id ?? "",
        calendarType: "caldav",
        ingestFailureCount: 3,
        ingestNextAttemptAt: new Date(),
        name: "Clock",
        userId: USER_ID,
      })
      .returning({ id: calendarsTable.id });

    const [observed] = await database
      .select({
        failureCount: calendarsTable.ingestFailureCount,
        nextAttemptAt: calendarsTable.ingestNextAttemptAt,
      })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendar?.id ?? ""))
      .limit(1);

    const updated = await database
      .update(calendarsTable)
      .set({ ingestFailureCount: (observed?.failureCount ?? 0) + 1 })
      .where(and(
        eq(calendarsTable.id, calendar?.id ?? ""),
        eq(calendarsTable.ingestFailureCount, observed?.failureCount ?? 0),
        eq(calendarsTable.ingestNextAttemptAt, observed?.nextAttemptAt ?? new Date()),
      ))
      .returning({ id: calendarsTable.id });

    expect(updated).toHaveLength(1);
  });
});
