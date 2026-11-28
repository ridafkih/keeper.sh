import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SQL } from "bun";
import {
  SecretDecryptionError,
  closeDatabase,
  createDatabase,
  createKeyring,
} from "@keeper.sh/database";
import type { Keyring } from "@keeper.sh/database";

interface CapturedOAuthConfig {
  accessToken: string;
  refreshAccessToken: (refreshToken: string) => Promise<{ access_token: string }>;
  refreshToken: string;
}

interface CapturedCalDAVConfig {
  password: string;
}

const captured = vi.hoisted(() => ({
  caldav: [] as CapturedCalDAVConfig[],
  google: [] as CapturedOAuthConfig[],
  outlook: [] as CapturedOAuthConfig[],
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSyncProvider: (config: CapturedOAuthConfig) => {
    captured.google.push(config);
    return { name: "google" };
  },
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSyncProvider: (config: CapturedOAuthConfig) => {
    captured.outlook.push(config);
    return { name: "outlook" };
  },
}));

vi.mock("@keeper.sh/calendar/caldav", () => ({
  createCalDAVSyncProvider: (config: CapturedCalDAVConfig) => {
    captured.caldav.push(config);
    return { name: "caldav" };
  },
}));

const { createCoordinatedRefresher, createRegistrarContextFactory } = await import(
  "@keeper.sh/calendar"
);
const { resolveSyncProvider } = await import("../src/resolve-provider");

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../database/scripts/migrate.ts`;
const databaseName = `keeper_sync_credential_encryption_${process.pid}`;

const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const USER_ID = "credential-owner";
const OAUTH_CONFIG = {
  googleClientId: "google-client",
  googleClientSecret: "google-secret",
  microsoftClientId: "microsoft-client",
  microsoftClientSecret: "microsoft-secret",
};

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

const readingKeyring = (): Keyring => createKeyring({ primaryKey: ENCRYPTION_KEY });
const encryptingKeyring = (): Keyring =>
  createKeyring({ encryptOnWrite: true, primaryKey: ENCRYPTION_KEY });

describe.skipIf(!administrativeUrl)("stored credentials against Postgres", () => {
  let client: SQL | null = null;
  let database: Awaited<ReturnType<typeof createDatabase>> | null = null;

  const requireClient = (): SQL => {
    if (!client) {
      throw new Error("database not ready");
    }
    return client;
  };

  const requireDatabase = (): Awaited<ReturnType<typeof createDatabase>> => {
    if (!database) {
      throw new Error("database not ready");
    }
    return database;
  };

  interface SeededOAuthCalendar {
    accountId: string;
    calendarId: string;
    credentialId: string;
  }

  const seedOAuthCalendar = async (
    provider: "google" | "outlook",
    tokens: { accessToken: string; refreshToken: string },
    expiresInSeconds = 3600,
  ): Promise<SeededOAuthCalendar> => {
    const sql = requireClient();
    const [credential] = await sql<{ id: string }[]>`
      INSERT INTO "oauth_credentials" ("accessToken", "expiresAt", "provider", "refreshToken", "userId")
      VALUES (
        ${tokens.accessToken},
        now() + make_interval(secs => ${expiresInSeconds}),
        ${provider},
        ${tokens.refreshToken},
        ${USER_ID}
      )
      RETURNING "id"
    `;
    const [account] = await sql<{ id: string }[]>`
      INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "oauthCredentialId")
      VALUES ('oauth', ${provider}, ${USER_ID}, ${credential?.id}::uuid)
      RETURNING "id"
    `;
    const [calendar] = await sql<{ id: string }[]>`
      INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId", "capabilities", "externalCalendarId")
      VALUES (${account?.id}::uuid, 'oauth', 'Calendar', ${USER_ID}, ARRAY['pull', 'push'], 'primary')
      RETURNING "id"
    `;
    return {
      accountId: account?.id ?? "",
      calendarId: calendar?.id ?? "",
      credentialId: credential?.id ?? "",
    };
  };

  const encryptStoredTokens = async (credentialId: string): Promise<void> => {
    const { oauthCredentialsTable } = await import("@keeper.sh/database/schema");
    const { encryptStoredOAuthCredential } = await import("./helpers/encrypt-stored-credential");
    await encryptStoredOAuthCredential(
      requireDatabase(),
      oauthCredentialsTable,
      credentialId,
      encryptingKeyring(),
    );
  };

  const readStoredTokens = async (
    credentialId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> => {
    const [row] = await requireClient()<{ accessToken: string; refreshToken: string }[]>`
      SELECT "accessToken", "refreshToken" FROM "oauth_credentials" WHERE "id" = ${credentialId}::uuid
    `;
    if (!row) {
      throw new Error(`credential ${credentialId} not found`);
    }
    return row;
  };

  const resolveOAuth = async (
    seeded: SeededOAuthCalendar,
    provider: "google" | "outlook",
    keyring: Keyring,
  ): Promise<CapturedOAuthConfig> => {
    captured[provider].length = 0;
    await resolveSyncProvider({
      accountId: seeded.accountId,
      calendarId: seeded.calendarId,
      database: requireDatabase(),
      keyring,
      oauthConfig: OAUTH_CONFIG,
      provider,
      userId: USER_ID,
    });
    const [config] = captured[provider];
    if (!config) {
      throw new Error(`no ${provider} provider was constructed`);
    }
    return config;
  };

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
    client = new SQL(buildDatabaseUrl(databaseName));
    database = await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 2 });
    await client`INSERT INTO "user" ("id", "email", "name") VALUES (${USER_ID}, 'owner@example.com', 'Owner')`;
  }, 300_000);

  afterAll(async () => {
    if (database) {
      closeDatabase(database, { graceSeconds: 1 });
    }
    await client?.close();
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  it("resolves a destination provider from a row holding plaintext tokens", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "plain-access",
      refreshToken: "plain-refresh",
    });

    const config = await resolveOAuth(seeded, "google", readingKeyring());

    expect(config.accessToken).toBe("plain-access");
    expect(config.refreshToken).toBe("plain-refresh");
  });

  it("resolves a destination provider from a row holding plaintext tokens when no key is configured", async () => {
    const seeded = await seedOAuthCalendar("outlook", {
      accessToken: "keyless-access",
      refreshToken: "keyless-refresh",
    });

    const config = await resolveOAuth(seeded, "outlook", createKeyring());

    expect(config.accessToken).toBe("keyless-access");
    expect(config.refreshToken).toBe("keyless-refresh");
  });

  it("resolves a destination provider from a row holding encrypted tokens", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "sealed-access",
      refreshToken: "sealed-refresh",
    });
    await encryptStoredTokens(seeded.credentialId);
    const stored = await readStoredTokens(seeded.credentialId);
    expect(stored.accessToken.startsWith("enc:v1:")).toBe(true);
    expect(stored.refreshToken.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("sealed-access");
    expect(JSON.stringify(stored)).not.toContain("sealed-refresh");

    const config = await resolveOAuth(seeded, "google", readingKeyring());

    expect(config.accessToken).toBe("sealed-access");
    expect(config.refreshToken).toBe("sealed-refresh");
  });

  it("resolves a row whose access token is encrypted and refresh token is not", async () => {
    const seeded = await seedOAuthCalendar("outlook", {
      accessToken: "mixed-access",
      refreshToken: "mixed-refresh",
    });
    await encryptStoredTokens(seeded.credentialId);
    await requireClient()`
      UPDATE "oauth_credentials" SET "refreshToken" = 'mixed-refresh' WHERE "id" = ${seeded.credentialId}::uuid
    `;

    const config = await resolveOAuth(seeded, "outlook", readingKeyring());

    expect(config.accessToken).toBe("mixed-access");
    expect(config.refreshToken).toBe("mixed-refresh");
  });

  it("refuses encrypted tokens that were copied onto another credential and leaves the account untouched", async () => {
    const source = await seedOAuthCalendar("google", {
      accessToken: "victim-access",
      refreshToken: "victim-refresh",
    });
    await encryptStoredTokens(source.credentialId);
    const target = await seedOAuthCalendar("google", {
      accessToken: "other-access",
      refreshToken: "other-refresh",
    });
    await requireClient()`
      UPDATE "oauth_credentials" AS target
      SET "accessToken" = source."accessToken", "refreshToken" = source."refreshToken"
      FROM "oauth_credentials" AS source
      WHERE target."id" = ${target.credentialId}::uuid AND source."id" = ${source.credentialId}::uuid
    `;

    await expect(resolveOAuth(target, "google", readingKeyring()))
      .rejects.toBeInstanceOf(SecretDecryptionError);

    const [account] = await requireClient()<{ needsReauthentication: boolean }[]>`
      SELECT "needsReauthentication" FROM "calendar_accounts" WHERE "id" = ${target.accountId}::uuid
    `;
    expect(account?.needsReauthentication).toBe(false);
  });

  it("reports encrypted tokens it has no key for without changing the row or the account", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "unreadable-access",
      refreshToken: "unreadable-refresh",
    });
    await encryptStoredTokens(seeded.credentialId);
    const before = await readStoredTokens(seeded.credentialId);

    for (const keyring of [createKeyring(), createKeyring({ primaryKey: randomBytes(32).toString("base64") })]) {
      const failure = await resolveOAuth(seeded, "google", keyring).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SecretDecryptionError);
      expect((failure as SecretDecryptionError).reason).toBe("missing-key");
    }

    expect(await readStoredTokens(seeded.credentialId)).toEqual(before);
    const [account] = await requireClient()<{ needsReauthentication: boolean }[]>`
      SELECT "needsReauthentication" FROM "calendar_accounts" WHERE "id" = ${seeded.accountId}::uuid
    `;
    expect(account?.needsReauthentication).toBe(false);
  });

  it("stores refreshed tokens as plaintext while encryption on write is off", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
    }, 0);
    const refresher = createCoordinatedRefresher({
      calendarAccountId: seeded.accountId,
      database: requireDatabase(),
      keyring: readingKeyring(),
      oauthCredentialId: seeded.credentialId,
      rawRefresh: () => Promise.resolve({
        access_token: "fresh-access",
        expires_in: 3600,
        refresh_token: "fresh-refresh",
      }),
      refreshLockStore: null,
    });

    await refresher("stale-refresh");

    expect(await readStoredTokens(seeded.credentialId)).toEqual({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    });
  });

  it("refreshes a row holding encrypted tokens and keeps it readable", async () => {
    const seeded = await seedOAuthCalendar("outlook", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
    }, 0);
    await encryptStoredTokens(seeded.credentialId);
    const usedRefreshTokens: string[] = [];

    const config = await resolveOAuth(seeded, "outlook", encryptingKeyring());
    captured.outlook.length = 0;
    const refreshers = [config.refreshAccessToken];
    const [refresh] = refreshers;
    if (!refresh) {
      throw new Error("expected a refresher");
    }
    vi.stubGlobal("fetch", (_input: unknown, init?: { body?: unknown }) => {
      usedRefreshTokens.push(String(new URLSearchParams(String(init?.body)).get("refresh_token")));
      return Promise.resolve(Response.json({
        access_token: "rotated-access",
        expires_in: 3600,
        refresh_token: "rotated-refresh",
        scope: "Calendars.ReadWrite offline_access",
        token_type: "Bearer",
      }));
    });
    try {
      const result = await refresh(config.refreshToken);
      expect(result.access_token).toBe("rotated-access");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(usedRefreshTokens).toEqual(["stale-refresh"]);
    const stored = await readStoredTokens(seeded.credentialId);
    expect(stored.accessToken.startsWith("enc:v1:")).toBe(true);
    expect(stored.refreshToken.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("rotated-access");
    expect(JSON.stringify(stored)).not.toContain("rotated-refresh");

    const reread = await resolveOAuth(seeded, "outlook", readingKeyring());
    expect(reread.accessToken).toBe("rotated-access");
    expect(reread.refreshToken).toBe("rotated-refresh");
  });

  it("adopts an encrypted access token a peer already refreshed", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "peer-access",
      refreshToken: "peer-refresh",
    });
    await encryptStoredTokens(seeded.credentialId);
    let refreshCalls = 0;
    const refresher = createCoordinatedRefresher({
      calendarAccountId: seeded.accountId,
      database: requireDatabase(),
      keyring: readingKeyring(),
      oauthCredentialId: seeded.credentialId,
      rawRefresh: () => {
        refreshCalls += 1;
        return Promise.resolve({ access_token: "unexpected", expires_in: 3600 });
      },
      refreshLockStore: {
        release: () => Promise.resolve(),
        tryAcquire: () => Promise.resolve(true),
      },
    });

    const result = await refresher("peer-refresh");

    expect(result.access_token).toBe("peer-access");
    expect(refreshCalls).toBe(0);
  });

  it("resolves a push channel access token from an encrypted row", async () => {
    const seeded = await seedOAuthCalendar("google", {
      accessToken: "channel-access",
      refreshToken: "channel-refresh",
    });
    await encryptStoredTokens(seeded.credentialId);
    const createRegistrarContext = createRegistrarContextFactory({
      database: requireDatabase(),
      googleClientId: OAUTH_CONFIG.googleClientId,
      googleClientSecret: OAUTH_CONFIG.googleClientSecret,
      keyring: readingKeyring(),
      rateLimiterRedis: {} as never,
      refreshLockStore: {
        release: () => Promise.resolve(),
        tryAcquire: () => Promise.resolve(true),
      },
      webhookConfig: {
        googleCallbackUrl: "https://keeper.example/google",
        outlookCallbackUrl: "https://keeper.example/outlook",
      },
    });

    const context = await createRegistrarContext({
      channelId: "channel-1",
      provider: "google",
      requestedExpiresAt: new Date(),
      scope: { accountId: seeded.accountId, calendarId: seeded.calendarId, userId: USER_ID },
    } as never);

    expect(context.accessToken).toBe("channel-access");
  });

  it("resolves a CalDAV destination from a password in the original format and in the versioned format", async () => {
    const sql = requireClient();
    const { caldavCredentialsTable } = await import("@keeper.sh/database/schema");
    const { sealSecret } = await import("@keeper.sh/database");
    const seedCalDAV = async (keyring: Keyring, password: string): Promise<SeededOAuthCalendar> => {
      const credentialId = crypto.randomUUID();
      await requireDatabase().insert(caldavCredentialsTable).values({
        encryptedPassword: sealSecret(
          "caldav_credentials.encryptedPassword",
          password,
          keyring,
          credentialId,
        ),
        id: credentialId,
        serverUrl: "https://dav.example.com/",
        username: "dav-user",
      });
      const [account] = await sql<{ id: string }[]>`
        INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "caldavCredentialId")
        VALUES ('caldav', 'caldav', ${USER_ID}, ${credentialId}::uuid)
        RETURNING "id"
      `;
      const [calendar] = await sql<{ id: string }[]>`
        INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId", "capabilities", "calendarUrl")
        VALUES (${account?.id}::uuid, 'caldav', 'DAV', ${USER_ID}, ARRAY['pull', 'push'], 'https://dav.example.com/cal/')
        RETURNING "id"
      `;
      return { accountId: account?.id ?? "", calendarId: calendar?.id ?? "", credentialId };
    };
    const original = await seedCalDAV(readingKeyring(), "original-format-password");
    const versioned = await seedCalDAV(encryptingKeyring(), "versioned-format-password");
    const stored = await sql<{ encryptedPassword: string; id: string }[]>`
      SELECT "id", "encryptedPassword" FROM "caldav_credentials"
      WHERE "id" IN (${original.credentialId}::uuid, ${versioned.credentialId}::uuid)
    `;
    const storedById = new Map(stored.map((row) => [row.id, row.encryptedPassword]));
    expect(storedById.get(original.credentialId)?.split(":")).toHaveLength(2);
    expect(storedById.get(versioned.credentialId)?.startsWith("enc:v1:")).toBe(true);

    captured.caldav.length = 0;
    for (const seeded of [original, versioned]) {
      await resolveSyncProvider({
        accountId: seeded.accountId,
        calendarId: seeded.calendarId,
        database: requireDatabase(),
        keyring: readingKeyring(),
        oauthConfig: OAUTH_CONFIG,
        provider: "caldav",
        userId: USER_ID,
      });
    }

    expect(captured.caldav.map(({ password }) => password)).toEqual([
      "original-format-password",
      "versioned-format-password",
    ]);
  });
});
