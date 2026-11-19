import { randomBytes } from "node:crypto";
import { SQL } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeDatabase, createDatabase, createKeyring, openSecret } from "@keeper.sh/database";
import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { readCredentialTokens } from "@keeper.sh/calendar";
import { resolveCredentialsByCalendarId } from "../../src/mutations/resolve-credentials";
import type { ProviderCredentials } from "../../src/types";
import type { importCalDAVCalendars as ImportCalDAVCalendars } from "../../src/utils/caldav-sources";
import type {
  refreshGoogleAccessToken as RefreshGoogleAccessToken,
  refreshGoogleSourceAccessToken as RefreshGoogleSourceAccessToken,
  refreshMicrosoftAccessToken as RefreshMicrosoftAccessToken,
  refreshMicrosoftSourceAccessToken as RefreshMicrosoftSourceAccessToken,
} from "../../src/utils/oauth-refresh";
import type { createOAuthSourceCredential as CreateOAuthSourceCredential } from "../../src/utils/oauth-source-credentials";
import type {
  applyCalDAVReconnect as ApplyCalDAVReconnect,
  getCalDAVReconnectTarget as GetCalDAVReconnectTarget,
} from "../../src/utils/reconnect-account";

type Database = Awaited<ReturnType<typeof createDatabase>>;

interface WritePaths {
  applyCalDAVReconnect: typeof ApplyCalDAVReconnect;
  createOAuthSourceCredential: typeof CreateOAuthSourceCredential;
  getCalDAVReconnectTarget: typeof GetCalDAVReconnectTarget;
  importCalDAVCalendars: typeof ImportCalDAVCalendars;
  refreshGoogleAccessToken: typeof RefreshGoogleAccessToken;
  refreshGoogleSourceAccessToken: typeof RefreshGoogleSourceAccessToken;
  refreshMicrosoftAccessToken: typeof RefreshMicrosoftAccessToken;
  refreshMicrosoftSourceAccessToken: typeof RefreshMicrosoftSourceAccessToken;
}

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_api_credential_writes_${process.pid}`;

const ENCRYPTED_PREFIX = "enc:v1:";
const EXPIRES_AT = new Date("2031-01-01T00:00:00.000Z");
const keyring = createKeyring({ primaryKey: randomBytes(32).toString("base64") });

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
const loaded: WritePaths[] = [];

const db = (): Database => {
  const [connection] = connections;
  if (!connection) {
    throw new Error("The scratch database is not connected");
  }
  return connection;
};

const writePaths = (): WritePaths => {
  const [paths] = loaded;
  if (!paths) {
    throw new Error("The write paths are not loaded");
  }
  return paths;
};

const seedUser = async (): Promise<string> => {
  const userId = `user-${crypto.randomUUID()}`;
  await db().execute(
    sql`INSERT INTO "user" ("id", "email", "name") VALUES (${userId}, ${`${userId}@example.com`}, 'Credential Fixture')`,
  );
  return userId;
};

const seedOAuthCalendar = async (
  userId: string,
  provider: string,
  oauthCredentialId: string,
): Promise<{ accountId: string; calendarId: string }> => {
  const [account] = await db()
    .insert(calendarAccountsTable)
    .values({ authType: "oauth", oauthCredentialId, provider, userId })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Account fixture was not inserted");
  }
  const [calendar] = await db()
    .insert(calendarsTable)
    .values({
      accountId: account.id,
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "primary",
      name: "Fixture",
      userId,
    })
    .returning({ id: calendarsTable.id });
  if (!calendar) {
    throw new Error("Calendar fixture was not inserted");
  }
  return { accountId: account.id, calendarId: calendar.id };
};

const readCredentials = async (userId: string, calendarId: string): Promise<ProviderCredentials> => {
  const credentials = await resolveCredentialsByCalendarId(db(), userId, calendarId);
  if (!credentials) {
    throw new Error(`Calendar ${calendarId} has no credentials`);
  }
  return credentials;
};

const readOAuthTokens = async (
  userId: string,
  calendarId: string,
): Promise<{ accessToken: string; credentialId: string; refreshToken: string }> => {
  const { oauth } = await readCredentials(userId, calendarId);
  if (!oauth) {
    throw new Error(`Calendar ${calendarId} has no OAuth credential`);
  }
  return {
    ...readCredentialTokens(
      {
        accessToken: oauth.accessToken,
        oauthCredentialId: oauth.credentialId,
        refreshToken: oauth.refreshToken,
      },
      keyring,
    ),
    credentialId: oauth.credentialId,
  };
};

const readCalDAVPassword = async (
  userId: string,
  calendarId: string,
): Promise<{ credentialId: string; password: string }> => {
  const { caldav } = await readCredentials(userId, calendarId);
  if (!caldav) {
    throw new Error(`Calendar ${calendarId} has no CalDAV credential`);
  }
  return {
    credentialId: caldav.credentialId,
    password: openSecret(caldav.encryptedPassword, keyring, caldav.credentialId),
  };
};

const readStoredOAuthColumns = async (credentialId: string): Promise<string[]> => {
  const rows = await db().execute(
    sql`SELECT "accessToken", "refreshToken" FROM "oauth_credentials" WHERE "id" = ${credentialId}::uuid`,
  ) as { accessToken: string; refreshToken: string }[];
  return rows.flatMap(({ accessToken, refreshToken }) => [accessToken, refreshToken]);
};

const readStoredCalDAVColumn = async (credentialId: string): Promise<string[]> => {
  const rows = await db().execute(
    sql`SELECT "encryptedPassword" FROM "caldav_credentials" WHERE "id" = ${credentialId}::uuid`,
  ) as { encryptedPassword: string }[];
  return rows.map(({ encryptedPassword }) => encryptedPassword);
};

const expectEncrypted = (stored: string[], expectedCount: number): void => {
  expect(stored).toHaveLength(expectedCount);
  for (const value of stored) {
    expect(value.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  }
};

const answerTokenRefreshWith = (grant: { access_token: string; refresh_token: string }): void => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(Response.json({
      ...grant,
      expires_in: 3600,
      scope: "calendar",
      token_type: "Bearer",
    })));
};

const seedStoredOAuthCalendar = async (
  provider: "google" | "outlook",
): Promise<{ accountId: string; calendarId: string; credentialId: string; userId: string }> => {
  const userId = await seedUser();
  const credentialId = await writePaths().createOAuthSourceCredential(userId, {
    accessToken: `${provider}-access-before-refresh`,
    email: `${userId}@example.com`,
    expiresAt: EXPIRES_AT,
    provider,
    refreshToken: `${provider}-refresh-before-refresh`,
  });
  return { ...await seedOAuthCalendar(userId, provider, credentialId), credentialId, userId };
};

describe.skipIf(!administrativeUrl)("credentials stored by the API with encryption on", () => {
  beforeAll(async () => {
    await withAdministrativeConnection(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await withAdministrativeConnection(`CREATE DATABASE "${databaseName}"`);
    await runMigrations();
    const database = await createDatabase(buildDatabaseUrl(databaseName));
    connections.push(database);

    vi.doMock("@/env", () => ({ default: {} }));
    vi.doMock("@/context", () => ({
      database,
      env: {
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        MICROSOFT_CLIENT_ID: "microsoft-client",
        MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      },
      keyring,
      premiumService: {
        getAccountLimit: () => Number.POSITIVE_INFINITY,
        getUserPlan: () => Promise.resolve("pro"),
      },
    }));
    vi.doMock("@/utils/enqueue-push-sync", () => ({
      enqueuePushSync: () => Promise.resolve(),
    }));
    vi.doMock("@keeper.sh/calendar/caldav", async (importOriginal) => ({
      ...await importOriginal<Record<string, unknown>>(),
      createCalDAVClient: () => ({
        fetchCalendarWritable: () => Promise.resolve(true),
      }),
    }));

    loaded.push({
      ...await import("../../src/utils/oauth-source-credentials"),
      ...await import("../../src/utils/oauth-refresh"),
      ...await import("../../src/utils/caldav-sources"),
      ...await import("../../src/utils/reconnect-account"),
    });
  }, 300_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    for (const connection of connections) {
      await closeDatabase(connection);
    }
    await withAdministrativeConnection(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  }, 120_000);

  it("reads back the tokens of a newly connected OAuth account", async () => {
    const userId = await seedUser();

    const credentialId = await writePaths().createOAuthSourceCredential(userId, {
      accessToken: "first-access",
      email: "first@example.com",
      expiresAt: EXPIRES_AT,
      provider: "google",
      refreshToken: "first-refresh",
    });

    const { calendarId } = await seedOAuthCalendar(userId, "google", credentialId);
    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "first-access",
      credentialId,
      refreshToken: "first-refresh",
    });
  });

  it("reads back the tokens of an OAuth account that was connected again", async () => {
    const userId = await seedUser();
    const account = {
      email: "again@example.com",
      expiresAt: EXPIRES_AT,
      provider: "google",
    };
    const credentialId = await writePaths().createOAuthSourceCredential(userId, {
      ...account,
      accessToken: "earlier-access",
      refreshToken: "earlier-refresh",
    });
    const { calendarId } = await seedOAuthCalendar(userId, "google", credentialId);

    const reconnectedId = await writePaths().createOAuthSourceCredential(userId, {
      ...account,
      accessToken: "later-access",
      refreshToken: "later-refresh",
    });

    expect(reconnectedId).toBe(credentialId);
    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "later-access",
      credentialId,
      refreshToken: "later-refresh",
    });
  });

  it("reads back the tokens a Google source refresh stored", async () => {
    const { calendarId, credentialId, userId } = await seedStoredOAuthCalendar("google");
    answerTokenRefreshWith({ access_token: "google-source-access", refresh_token: "google-source-refresh" });

    await writePaths().refreshGoogleSourceAccessToken(credentialId, "google-refresh-before-refresh");

    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "google-source-access",
      credentialId,
      refreshToken: "google-source-refresh",
    });
  });

  it("reads back the tokens a Microsoft source refresh stored", async () => {
    const { calendarId, credentialId, userId } = await seedStoredOAuthCalendar("outlook");
    answerTokenRefreshWith({ access_token: "microsoft-source-access", refresh_token: "microsoft-source-refresh" });

    await writePaths().refreshMicrosoftSourceAccessToken(credentialId, "outlook-refresh-before-refresh");

    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "microsoft-source-access",
      credentialId,
      refreshToken: "microsoft-source-refresh",
    });
  });

  it("reads back the tokens a Google account refresh stored", async () => {
    const { accountId, calendarId, credentialId, userId } = await seedStoredOAuthCalendar("google");
    answerTokenRefreshWith({ access_token: "google-account-access", refresh_token: "google-account-refresh" });

    await writePaths().refreshGoogleAccessToken(accountId, "google-refresh-before-refresh");

    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "google-account-access",
      credentialId,
      refreshToken: "google-account-refresh",
    });
  });

  it("reads back the tokens a Microsoft account refresh stored", async () => {
    const { accountId, calendarId, credentialId, userId } = await seedStoredOAuthCalendar("outlook");
    answerTokenRefreshWith({ access_token: "microsoft-account-access", refresh_token: "microsoft-account-refresh" });

    await writePaths().refreshMicrosoftAccessToken(accountId, "outlook-refresh-before-refresh");

    expectEncrypted(await readStoredOAuthColumns(credentialId), 2);
    expect(await readOAuthTokens(userId, calendarId)).toEqual({
      accessToken: "microsoft-account-access",
      credentialId,
      refreshToken: "microsoft-account-refresh",
    });
  });

  it("reads back the password of a newly imported CalDAV account", async () => {
    const userId = await seedUser();

    const imported = await writePaths().importCalDAVCalendars(userId, {
      authMethod: "basic",
      calendars: [{ calendarUrl: "https://caldav.example.invalid/calendars/home/", name: "Home" }],
      password: "imported-app-password",
      provider: "caldav",
      serverUrl: "https://caldav.example.invalid/",
      username: "person@example.invalid",
    });

    const [calendar] = imported.calendars;
    if (!calendar) {
      throw new Error("The CalDAV calendar was not imported");
    }
    const stored = await readCalDAVPassword(userId, calendar.id);
    expectEncrypted(await readStoredCalDAVColumn(stored.credentialId), 1);
    expect(stored.password).toBe("imported-app-password");
  });

  it("reads back the password a CalDAV reconnect stored", async () => {
    const userId = await seedUser();
    const imported = await writePaths().importCalDAVCalendars(userId, {
      authMethod: "basic",
      calendars: [{ calendarUrl: "https://caldav.example.invalid/calendars/work/", name: "Work" }],
      password: "password-before-reconnect",
      provider: "caldav",
      serverUrl: "https://caldav.example.invalid/",
      username: "person@example.invalid",
    });
    const [calendar] = imported.calendars;
    const target = await writePaths().getCalDAVReconnectTarget(db(), userId, imported.accountId);
    if (!calendar || !target) {
      throw new Error("The CalDAV account was not imported");
    }

    await writePaths().applyCalDAVReconnect(db(), target, "password-after-reconnect", "digest");

    const stored = await readCalDAVPassword(userId, calendar.id);
    expect(stored.credentialId).toBe(target.credentialId);
    expectEncrypted(await readStoredCalDAVColumn(stored.credentialId), 1);
    expect(stored.password).toBe("password-after-reconnect");
  });
});
