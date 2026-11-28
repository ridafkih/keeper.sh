import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  CREDENTIAL_TARGETS,
  CredentialStoreError,
  createCredentialEncryptionDatabase,
  describeCredentialEncryption,
  encryptStoredCredentials,
  resolveCredentialEncryptionKeys,
} from "../../src/database/credential-encryption";
import type {
  CredentialEncryptionDatabase,
  CredentialEncryptionKeys,
} from "../../src/database/credential-encryption";
import { KeyringConfigurationError, createKeyring } from "../../src/keyring";
import type { Keyring } from "../../src/keyring";
import { openSecret, readStoredSecret, sealSecret } from "../../src/stored-secret";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../scripts/migrate.ts`;
const databaseName = `keeper_credential_encryption_${process.pid}`;

const USER_ID = "credential-owner";
const OLD_KEY = randomBytes(32).toString("base64");
const NEW_KEY = randomBytes(32).toString("base64");
const UNUSABLE_KEY = "not-a-32-byte-key";
const ENCRYPTED_PREFIX = "enc:v1:";
const FIRST_CURSOR = "00000000-0000-0000-0000-000000000000";
const LOCK_NOT_AVAILABLE = "55P03";

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeClient = async (run: (client: Client) => Promise<void>): Promise<void> => {
  const client = new Client({ connectionString: administrativeUrl });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
};

const keysFor = (primaryKey: string, decryptOnlyKeys?: string): CredentialEncryptionKeys =>
  resolveCredentialEncryptionKeys({ decryptOnlyKeys, primaryKey });

const keyringFor = (primaryKey: string, decryptOnlyKeys?: string): Keyring =>
  createKeyring({ decryptOnlyKeys, primaryKey });

const originalFormatKeyring = (primaryKey: string): Keyring =>
  createKeyring({ encryptOnWrite: false, primaryKey });

const keyIdOf = (primaryKey: string): string => keyringFor(primaryKey).resolve().primary?.id ?? "";

const unreadDatabase: CredentialEncryptionDatabase = {
  readBatch: () => Promise.reject(new Error("read attempted")),
  writeChanges: () => Promise.reject(new Error("write attempted")),
};

const renderError = (error: unknown): string =>
  [
    String(error),
    JSON.stringify(error),
    Bun.inspect(error),
    error instanceof Error && error.stack,
  ].join("\n");

describe("the keys stored credentials are encrypted with", () => {
  it("leaves stored credentials alone when no key is set", async () => {
    for (const settings of [{}, { primaryKey: "" }, { primaryKey: "   " }]) {
      const keys = resolveCredentialEncryptionKeys(settings);
      const outcome = await encryptStoredCredentials(unreadDatabase, keys);

      expect(keys).toEqual({ keyring: null, skipReason: "ENCRYPTION_KEY is not set" });
      expect(outcome).toMatchObject({
        passes: 0,
        primaryKeyId: null,
        skipReason: "ENCRYPTION_KEY is not set",
        status: "skipped",
        valuesConverted: 0,
      });
    }
  });

  it("leaves stored credentials alone when the key cannot be used, and says why without the key", async () => {
    const keys = resolveCredentialEncryptionKeys({ primaryKey: UNUSABLE_KEY });
    const outcome = await encryptStoredCredentials(unreadDatabase, keys);
    const report = describeCredentialEncryption(outcome, new Date("2031-01-01T00:00:00.000Z"));

    expect(outcome).toMatchObject({
      skipReason: "ENCRYPTION_KEY must be 32 bytes (base64 encoded)",
      status: "skipped",
    });
    expect(report.level).toBe(40);
    expect(JSON.stringify(report)).not.toContain(UNUSABLE_KEY);
  });

  it("rejects a decrypt-only key that cannot be used before anything is read", () => {
    const readProblem = (): string => {
      try {
        resolveCredentialEncryptionKeys({
          decryptOnlyKeys: `${OLD_KEY},${UNUSABLE_KEY}`,
          primaryKey: NEW_KEY,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(KeyringConfigurationError);
        return renderError(error);
      }
      return "";
    };

    const problem = readProblem();

    expect(problem).toContain("ENCRYPTION_KEYS_DECRYPT_ONLY entry 2 must be 32 bytes (base64 encoded)");
    for (const key of [OLD_KEY, NEW_KEY, UNUSABLE_KEY]) {
      expect(problem).not.toContain(key);
    }
  });

  it("rejects decrypt-only keys given without a key to write with", () => {
    expect(() => resolveCredentialEncryptionKeys({ decryptOnlyKeys: OLD_KEY }))
      .toThrow(KeyringConfigurationError);
  });

  it("reports a run with no key as informational", () => {
    const report = describeCredentialEncryption(
      {
        decryptOnlyKeyIds: [],
        passes: 0,
        primaryKeyId: null,
        rowsContended: 0,
        rowsFailed: {},
        rowsScanned: 0,
        skipReason: "ENCRYPTION_KEY is not set",
        status: "skipped",
        stopped: null,
        valuesConverted: 0,
        valuesUnreadable: {},
      },
      new Date("2031-01-01T00:00:00.000Z"),
    );

    expect(report).toMatchObject({
      "credential_encryption.skip_reason": "ENCRYPTION_KEY is not set",
      "credential_encryption.status": "skipped",
      level: 30,
      msg: "stored credentials were left as they are",
      time: "2031-01-01T00:00:00.000Z",
    });
  });
});

describe.skipIf(!administrativeUrl)("encrypting stored credentials against Postgres", () => {
  let client: Client | null = null;
  let store: CredentialEncryptionDatabase | null = null;

  const requireClient = (): Client => {
    if (!client) {
      throw new Error("database not ready");
    }
    return client;
  };

  const requireStore = (): CredentialEncryptionDatabase => {
    if (!store) {
      throw new Error("database not ready");
    }
    return store;
  };

  interface StoredOAuthRow {
    accessToken: string;
    id: string;
    refreshToken: string;
  }

  interface MigrationRun {
    exitCode: number;
    printed: string;
    report: Record<string, unknown> | null;
  }

  const seedOAuthCredential = async (accessToken: string, refreshToken: string): Promise<string> => {
    const result = await requireClient().query<{ id: string }>(
      `INSERT INTO "oauth_credentials" ("accessToken", "expiresAt", "provider", "refreshToken", "userId")
       VALUES ($1, now() + interval '1 hour', 'google', $2, $3) RETURNING "id"`,
      [accessToken, refreshToken, USER_ID],
    );
    return result.rows[0]?.id ?? "";
  };

  const seedCalDAVCredential = async (password: string, keyring: Keyring): Promise<string> => {
    const id = crypto.randomUUID();
    const sealed = sealSecret("caldav_credentials.encryptedPassword", password, keyring, id);
    await requireClient().query(
      `INSERT INTO "caldav_credentials" ("id", "encryptedPassword", "serverUrl", "username")
       VALUES ($1, $2, 'https://dav.example.com/', 'dav-user')`,
      [id, sealed.stored],
    );
    return id;
  };

  const readOAuthRows = async (): Promise<StoredOAuthRow[]> => {
    const result = await requireClient().query<StoredOAuthRow>(
      `SELECT "id", "accessToken", "refreshToken" FROM "oauth_credentials" ORDER BY "id"`,
    );
    return result.rows;
  };

  const readOAuthRow = async (id: string): Promise<StoredOAuthRow> => {
    const rows = await readOAuthRows();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error("expected the credential row");
    }
    return row;
  };

  const readCalDAVPassword = async (id: string): Promise<string> => {
    const result = await requireClient().query<{ encryptedPassword: string }>(
      `SELECT "encryptedPassword" FROM "caldav_credentials" WHERE "id" = $1`,
      [id],
    );
    return result.rows[0]?.encryptedPassword ?? "";
  };

  const openOAuthRow = (row: StoredOAuthRow, keyring: Keyring) => ({
    accessToken: openSecret(
      readStoredSecret("oauth_credentials.accessToken", row.accessToken),
      keyring,
      row.id,
    ),
    refreshToken: openSecret(
      readStoredSecret("oauth_credentials.refreshToken", row.refreshToken),
      keyring,
      row.id,
    ),
  });

  const openCalDAVPassword = (stored: string, keyring: Keyring, id: string): string =>
    openSecret(readStoredSecret("caldav_credentials.encryptedPassword", stored), keyring, id);

  const seedPlaintextCredentials = async (count: number): Promise<void> => {
    for (let index = 0; index < count; index++) {
      await seedOAuthCredential(`access-${index}`, `refresh-${index}`);
    }
  };

  const withLockedRow = async (id: string, run: () => Promise<void>): Promise<void> => {
    const holder = new Client({ connectionString: buildDatabaseUrl(databaseName) });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM "oauth_credentials" WHERE "id" = $1 FOR UPDATE`, [id]);
      await run();
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
  };

  const withRefusedWrites = async (id: string, run: () => Promise<void>): Promise<void> => {
    await requireClient().query(`
      CREATE FUNCTION refuse_credential_write() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'row is busy' USING ERRCODE = '${LOCK_NOT_AVAILABLE}';
      END;
      $$ LANGUAGE plpgsql
    `);
    await requireClient().query(`
      CREATE TRIGGER refuse_credential_write BEFORE UPDATE ON "oauth_credentials"
      FOR EACH ROW WHEN (OLD."id" = '${id}') EXECUTE FUNCTION refuse_credential_write()
    `);
    try {
      await run();
    } finally {
      await requireClient().query(`DROP TRIGGER refuse_credential_write ON "oauth_credentials"`);
      await requireClient().query(`DROP FUNCTION refuse_credential_write()`);
    }
  };

  const runMigration = async (environment: Record<string, string>): Promise<MigrationRun> => {
    const result = await Bun.$`bun ${migrationScript}`
      .env({
        ...process.env,
        DATABASE_URL: buildDatabaseUrl(databaseName),
        ENCRYPTION_KEY: "",
        ENCRYPTION_KEYS_DECRYPT_ONLY: "",
        ...environment,
      })
      .quiet()
      .nothrow();
    const stdout = result.stdout.toString();
    const reportLine = stdout
      .split("\n")
      .find((line) => line.includes("credential_encryption.status"));
    let report: Record<string, unknown> | null = null;
    if (reportLine) {
      report = JSON.parse(reportLine) as Record<string, unknown>;
    }
    return {
      exitCode: result.exitCode,
      printed: `${stdout}${result.stderr.toString()}`,
      report,
    };
  };

  beforeAll(async () => {
    await withAdministrativeClient(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    });
    const migrated = await runMigration({});
    if (migrated.exitCode !== 0) {
      throw new Error("Migration failed");
    }
    client = new Client({ connectionString: buildDatabaseUrl(databaseName) });
    await client.connect();
    store = createCredentialEncryptionDatabase(drizzle(client));
    await client.query(
      `INSERT INTO "user" ("id", "email", "name") VALUES ($1, 'owner@example.com', 'Owner')`,
      [USER_ID],
    );
  }, 300_000);

  beforeEach(async () => {
    await requireClient().query(`DELETE FROM "calendar_accounts"`);
    await requireClient().query(`DELETE FROM "oauth_credentials"`);
    await requireClient().query(`DELETE FROM "caldav_credentials"`);
  });

  afterAll(async () => {
    await client?.end();
    await withAdministrativeClient(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  it("encrypts every plaintext token and leaves each one readable", async () => {
    await seedPlaintextCredentials(5);

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY), { batchSize: 2 });

    expect(outcome).toEqual({
      decryptOnlyKeyIds: [],
      passes: 1,
      primaryKeyId: keyIdOf(OLD_KEY),
      rowsContended: 0,
      rowsFailed: {},
      rowsScanned: 5,
      skipReason: null,
      status: "complete",
      stopped: null,
      valuesConverted: 10,
      valuesUnreadable: {},
    });
    const rows = await readOAuthRows();
    for (const row of rows) {
      expect(row.accessToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(row.refreshToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    }
    expect(rows.map((row) => openOAuthRow(row, keyringFor(OLD_KEY)).accessToken).toSorted())
      .toEqual(["access-0", "access-1", "access-2", "access-3", "access-4"]);
    expect(rows.map((row) => openOAuthRow(row, keyringFor(OLD_KEY)).refreshToken).toSorted())
      .toEqual(["refresh-0", "refresh-1", "refresh-2", "refresh-3", "refresh-4"]);
  });

  it("reads and writes nothing when run again", async () => {
    await seedPlaintextCredentials(3);
    await seedCalDAVCredential("dav-password", originalFormatKeyring(OLD_KEY));
    await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));
    const oauthBefore = await readOAuthRows();
    const real = requireStore();
    let rowsRead = 0;
    const counting: CredentialEncryptionDatabase = {
      readBatch: async (target, request) => {
        const rows = await real.readBatch(target, request);
        rowsRead += rows.length;
        return rows;
      },
      writeChanges: () => Promise.reject(new Error("write attempted")),
    };

    const outcome = await encryptStoredCredentials(counting, keysFor(OLD_KEY));

    expect(outcome).toMatchObject({
      passes: 1,
      rowsScanned: 0,
      status: "complete",
      valuesConverted: 0,
    });
    expect(rowsRead).toBe(0);
    expect(await readOAuthRows()).toEqual(oauthBefore);
  });

  it("leaves a value that is already under the current key exactly as stored", async () => {
    const keyring = keyringFor(OLD_KEY);
    const id = await seedOAuthCredential("placeholder", "still-plaintext-refresh");
    const sealedAccess = sealSecret("oauth_credentials.accessToken", "current-access", keyring, id);
    await requireClient().query(
      `UPDATE "oauth_credentials" SET "accessToken" = $1 WHERE "id" = $2`,
      [sealedAccess.stored, id],
    );

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(outcome).toMatchObject({ rowsScanned: 1, status: "complete", valuesConverted: 1 });
    const row = await readOAuthRow(id);
    expect(row.accessToken).toBe(sealedAccess.stored);
    expect(openOAuthRow(row, keyring)).toEqual({
      accessToken: "current-access",
      refreshToken: "still-plaintext-refresh",
    });
  });

  it("moves a CalDAV password from the original format to the versioned one", async () => {
    const id = await seedCalDAVCredential("dav-password", originalFormatKeyring(OLD_KEY));
    const before = await readCalDAVPassword(id);

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(before.startsWith(ENCRYPTED_PREFIX)).toBe(false);
    expect(outcome).toMatchObject({ rowsScanned: 1, status: "complete", valuesConverted: 1 });
    const after = await readCalDAVPassword(id);
    expect(after.startsWith(`${ENCRYPTED_PREFIX}${keyIdOf(OLD_KEY)}:`)).toBe(true);
    expect(openCalDAVPassword(after, keyringFor(OLD_KEY), id)).toBe("dav-password");
  });

  it("moves every value to a new key so the previous key can be removed", async () => {
    const oauthId = await seedOAuthCredential("rotating-access", "rotating-refresh");
    const versionedId = await seedCalDAVCredential("versioned-password", keyringFor(OLD_KEY));
    const originalId = await seedCalDAVCredential("original-password", originalFormatKeyring(OLD_KEY));
    await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(NEW_KEY, OLD_KEY));

    expect(outcome).toMatchObject({
      decryptOnlyKeyIds: [keyIdOf(OLD_KEY)],
      primaryKeyId: keyIdOf(NEW_KEY),
      rowsScanned: 3,
      status: "complete",
      valuesConverted: 4,
    });
    const newKeyOnly = keyringFor(NEW_KEY);
    expect(openOAuthRow(await readOAuthRow(oauthId), newKeyOnly)).toEqual({
      accessToken: "rotating-access",
      refreshToken: "rotating-refresh",
    });
    expect(openCalDAVPassword(await readCalDAVPassword(versionedId), newKeyOnly, versionedId))
      .toBe("versioned-password");
    expect(openCalDAVPassword(await readCalDAVPassword(originalId), newKeyOnly, originalId))
      .toBe("original-password");
  });

  it("leaves a value it cannot read, counts it, and converts the rest", async () => {
    const unreadableId = await seedOAuthCredential("placeholder", "readable-refresh");
    const lostKeyValue = sealSecret(
      "oauth_credentials.accessToken",
      "sealed-under-a-lost-key",
      keyringFor(NEW_KEY),
      unreadableId,
    );
    await requireClient().query(
      `UPDATE "oauth_credentials" SET "accessToken" = $1 WHERE "id" = $2`,
      [lostKeyValue.stored, unreadableId],
    );
    const readableId = await seedOAuthCredential("readable-access", "other-refresh");

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(outcome).toMatchObject({
      rowsScanned: 2,
      status: "incomplete",
      stopped: null,
      valuesConverted: 3,
      valuesUnreadable: { "missing-key": 1 },
    });
    const unreadable = await readOAuthRow(unreadableId);
    expect(unreadable.accessToken).toBe(lostKeyValue.stored);
    expect(unreadable.refreshToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(openOAuthRow(await readOAuthRow(readableId), keyringFor(OLD_KEY))).toEqual({
      accessToken: "readable-access",
      refreshToken: "other-refresh",
    });
  });

  it("leaves an empty stored value empty", async () => {
    const id = await seedOAuthCredential("", "only-refresh");

    const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(outcome).toMatchObject({ status: "complete", valuesConverted: 1 });
    const row = await readOAuthRow(id);
    expect(row.accessToken).toBe("");
    expect(row.refreshToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  });

  it("does not overwrite a token that was refreshed after it was read", async () => {
    const id = await seedOAuthCredential("read-access", "read-refresh");
    const [target] = CREDENTIAL_TARGETS;
    if (!target) {
      throw new Error("expected the OAuth credential target");
    }
    const [row] = await requireStore().readBatch(target, {
      afterId: FIRST_CURSOR,
      batchSize: 10,
      currentKeyId: keyIdOf(OLD_KEY),
    });
    const previous = row?.secrets.accessToken;
    if (!previous) {
      throw new Error("expected the stored access token");
    }
    await requireClient().query(
      `UPDATE "oauth_credentials" SET "accessToken" = 'refreshed-meanwhile' WHERE "id" = $1`,
      [id],
    );

    const written = await requireStore().writeChanges(target, id, [
      {
        name: "accessToken",
        next: sealSecret("oauth_credentials.accessToken", "read-access", keyringFor(OLD_KEY), id),
        previous,
      },
    ]);

    const stored = await readOAuthRow(id);
    expect(written).toBe(false);
    expect(stored.accessToken).toBe("refreshed-meanwhile");
  });

  it("converges on the refreshed token when a row changes underneath it", async () => {
    const id = await seedOAuthCredential("first-access", "first-refresh");
    const real = requireStore();
    let interfered = false;
    const racing: CredentialEncryptionDatabase = {
      readBatch: real.readBatch,
      writeChanges: async (target, rowId, changes) => {
        if (!interfered) {
          interfered = true;
          await requireClient().query(
            `UPDATE "oauth_credentials" SET "accessToken" = 'second-access' WHERE "id" = $1`,
            [id],
          );
        }
        return real.writeChanges(target, rowId, changes);
      },
    };

    const outcome = await encryptStoredCredentials(racing, keysFor(OLD_KEY));

    expect(outcome).toMatchObject({
      passes: 2,
      rowsContended: 0,
      status: "complete",
      valuesConverted: 2,
    });
    expect(openOAuthRow(await readOAuthRow(id), keyringFor(OLD_KEY))).toEqual({
      accessToken: "second-access",
      refreshToken: "first-refresh",
    });
  });

  it("passes over a row another session holds instead of waiting for it, and converts it on the next run", async () => {
    const heldId = await seedOAuthCredential("held-access", "held-refresh");
    const freeId = await seedOAuthCredential("free-access", "free-refresh");
    const before = await readOAuthRow(heldId);

    await withLockedRow(heldId, async () => {
      const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

      expect(outcome).toMatchObject({
        passes: 3,
        rowsContended: 1,
        rowsFailed: {},
        status: "incomplete",
        stopped: null,
        valuesConverted: 2,
      });
    });

    const free = await readOAuthRow(freeId);
    expect(await readOAuthRow(heldId)).toEqual(before);
    expect(free.accessToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);

    const nextRun = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(nextRun).toMatchObject({ rowsScanned: 1, status: "complete", valuesConverted: 2 });
    expect(openOAuthRow(await readOAuthRow(heldId), keyringFor(OLD_KEY))).toEqual({
      accessToken: "held-access",
      refreshToken: "held-refresh",
    });
  });

  it("counts a row the database refused to write and converts the others", async () => {
    const refusedId = await seedOAuthCredential("refused-access-value", "refused-refresh-value");
    const otherId = await seedOAuthCredential("other-access", "other-refresh");
    const before = await readOAuthRow(refusedId);

    await withRefusedWrites(refusedId, async () => {
      const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));
      const report = JSON.stringify(describeCredentialEncryption(outcome, new Date()));

      expect(outcome).toMatchObject({
        passes: 3,
        rowsFailed: { "lock-timeout": 1 },
        status: "incomplete",
        stopped: null,
        valuesConverted: 2,
      });
      expect(report).not.toContain("refused-access-value");
      expect(report).not.toContain("refused-refresh-value");
      expect(report).not.toContain(ENCRYPTED_PREFIX);
    });

    const other = await readOAuthRow(otherId);
    expect(await readOAuthRow(refusedId)).toEqual(before);
    expect(other.accessToken.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  });

  it("raises a refused write as an error that carries no stored or new value", async () => {
    const id = await seedOAuthCredential("raised-access-token-value", "raised-refresh-token-value");
    const [target] = CREDENTIAL_TARGETS;
    if (!target) {
      throw new Error("expected the OAuth credential target");
    }
    const [row] = await requireStore().readBatch(target, {
      afterId: FIRST_CURSOR,
      batchSize: 10,
      currentKeyId: keyIdOf(OLD_KEY),
    });
    const previous = row?.secrets.accessToken;
    if (!previous) {
      throw new Error("expected the stored access token");
    }
    const next = sealSecret(
      "oauth_credentials.accessToken",
      "raised-access-token-value",
      keyringFor(OLD_KEY),
      id,
    );
    const failures: unknown[] = [];

    await withRefusedWrites(id, async () => {
      await requireStore()
        .writeChanges(target, id, [{ name: "accessToken", next, previous }])
        .catch((error: unknown) => failures.push(error));
    });

    const [failure] = failures;
    expect(failure).toBeInstanceOf(CredentialStoreError);
    expect(failure).toMatchObject({
      failure: {
        operation: "write",
        reason: "lock-timeout",
        sqlState: LOCK_NOT_AVAILABLE,
        table: "oauth_credentials",
      },
    });
    const rendered = renderError(failure);
    for (const value of [next.stored, "raised-access-token-value", "raised-refresh-token-value"]) {
      expect(rendered).not.toContain(value);
    }
    expect(rendered).not.toContain(ENCRYPTED_PREFIX);
  });

  it("stops without failing when the store cannot be written at all, and reports why", async () => {
    await seedPlaintextCredentials(2);
    const before = await readOAuthRows();
    const real = requireStore();
    const denied: CredentialEncryptionDatabase = {
      readBatch: real.readBatch,
      writeChanges: () => Promise.reject(new CredentialStoreError({
        operation: "write",
        reason: "permission-denied",
        sqlState: "42501",
        table: "oauth_credentials",
      })),
    };

    const outcome = await encryptStoredCredentials(denied, keysFor(OLD_KEY));

    expect(outcome).toMatchObject({
      passes: 1,
      status: "incomplete",
      stopped: {
        operation: "write",
        reason: "permission-denied",
        sqlState: "42501",
        table: "oauth_credentials",
      },
      valuesConverted: 0,
    });
    expect(await readOAuthRows()).toEqual(before);
  });

  it("stops without failing when the store cannot be read, and reports why", async () => {
    await requireClient().query(`ALTER TABLE "caldav_credentials" RENAME TO "caldav_credentials_moved"`);
    try {
      await seedPlaintextCredentials(1);

      const outcome = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

      expect(outcome).toMatchObject({
        status: "incomplete",
        stopped: {
          operation: "read",
          reason: "table-not-found",
          sqlState: "42P01",
          table: "caldav_credentials",
        },
        valuesConverted: 2,
      });
    } finally {
      await requireClient().query(`ALTER TABLE "caldav_credentials_moved" RENAME TO "caldav_credentials"`);
    }
  });

  it("stops when its time is spent and continues from there on the next run", async () => {
    await seedPlaintextCredentials(4);
    const clock = { nowMs: 1000 };
    const real = requireStore();
    const slow: CredentialEncryptionDatabase = {
      readBatch: (target, request) => {
        clock.nowMs += 400;
        return real.readBatch(target, request);
      },
      writeChanges: real.writeChanges,
    };

    const firstRun = await encryptStoredCredentials(slow, keysFor(OLD_KEY), {
      batchSize: 1,
      now: () => clock.nowMs,
      timeBudgetMs: 1000,
    });

    expect(firstRun).toMatchObject({
      passes: 1,
      rowsScanned: 3,
      status: "incomplete",
      stopped: { operation: null, reason: "time-budget", sqlState: null, table: "oauth_credentials" },
      valuesConverted: 6,
    });

    const nextRun = await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));

    expect(nextRun).toMatchObject({ rowsScanned: 1, status: "complete", valuesConverted: 2 });
  });

  it("gives a calendar parked for a rejected credential one more attempt when its refresh token is encrypted", async () => {
    const credentialId = await seedOAuthCredential("parked-access", "parked-refresh");
    const account = await requireClient().query<{ id: string }>(
      `INSERT INTO "calendar_accounts" ("authType", "provider", "userId", "oauthCredentialId")
       VALUES ('oauth', 'google', $1, $2) RETURNING "id"`,
      [USER_ID, credentialId],
    );
    const calendar = await requireClient().query<{ id: string }>(
      `INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId", "capabilities")
       VALUES ($1, 'oauth', 'Parked', $2, ARRAY['pull']) RETURNING "id"`,
      [account.rows[0]?.id, USER_ID],
    );
    const calendarId = calendar.rows[0]?.id;
    const park = (): Promise<unknown> => requireClient().query(
      `UPDATE "source_ingest_schedule" SET "dueAt" = NULL, "parkedReason" = 'credential-rejected'
       WHERE "calendarId" = $1`,
      [calendarId],
    );
    const readParkedReason = async (): Promise<string | null> => {
      const schedule = await requireClient().query<{ parkedReason: string | null }>(
        `SELECT "parkedReason" FROM "source_ingest_schedule" WHERE "calendarId" = $1`,
        [calendarId],
      );
      return schedule.rows[0]?.parkedReason ?? null;
    };

    await park();
    await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));
    expect(await readParkedReason()).toBeNull();

    await park();
    await encryptStoredCredentials(requireStore(), keysFor(OLD_KEY));
    expect(await readParkedReason()).toBe("credential-rejected");
  });

  describe("as part of a migration run", () => {
    it("encrypts stored credentials when a key is set, and prints counts and key ids only", async () => {
      await seedPlaintextCredentials(3);
      const davId = await seedCalDAVCredential("migrated-dav-password", originalFormatKeyring(OLD_KEY));

      const run = await runMigration({ ENCRYPTION_KEY: OLD_KEY });

      expect(run.exitCode).toBe(0);
      expect(run.report).toMatchObject({
        "credential_encryption.decrypt_only_key_ids": [],
        "credential_encryption.primary_key_id": keyIdOf(OLD_KEY),
        "credential_encryption.rows_scanned": 4,
        "credential_encryption.status": "complete",
        "credential_encryption.values_converted": 7,
        level: 30,
      });
      expect(run.printed).not.toMatch(/access-\d|refresh-\d/);
      expect(run.printed).not.toContain("migrated-dav-password");
      expect(run.printed).not.toContain(ENCRYPTED_PREFIX);
      expect(run.printed).not.toContain(OLD_KEY);
      expect(run.printed).not.toContain(buildDatabaseUrl(databaseName));
      const rows = await readOAuthRows();
      expect(rows.map((row) => openOAuthRow(row, keyringFor(OLD_KEY)).accessToken).toSorted())
        .toEqual(["access-0", "access-1", "access-2"]);
      expect(openCalDAVPassword(await readCalDAVPassword(davId), keyringFor(OLD_KEY), davId))
        .toBe("migrated-dav-password");

      const again = await runMigration({ ENCRYPTION_KEY: OLD_KEY });

      expect(again.exitCode).toBe(0);
      expect(again.report).toMatchObject({
        "credential_encryption.rows_scanned": 0,
        "credential_encryption.status": "complete",
        "credential_encryption.values_converted": 0,
      });
      expect(await readOAuthRows()).toEqual(rows);
    }, 120_000);

    it("moves stored credentials to a new key when the previous one is listed as decrypt-only", async () => {
      await seedPlaintextCredentials(2);
      await runMigration({ ENCRYPTION_KEY: OLD_KEY });

      const run = await runMigration({
        ENCRYPTION_KEY: NEW_KEY,
        ENCRYPTION_KEYS_DECRYPT_ONLY: OLD_KEY,
      });

      expect(run.exitCode).toBe(0);
      expect(run.report).toMatchObject({
        "credential_encryption.decrypt_only_key_ids": [keyIdOf(OLD_KEY)],
        "credential_encryption.primary_key_id": keyIdOf(NEW_KEY),
        "credential_encryption.status": "complete",
        "credential_encryption.values_converted": 4,
      });
      expect(run.printed).not.toContain(OLD_KEY);
      expect(run.printed).not.toContain(NEW_KEY);
      const rows = await readOAuthRows();
      expect(rows.map((row) => openOAuthRow(row, keyringFor(NEW_KEY)).refreshToken).toSorted())
        .toEqual(["refresh-0", "refresh-1"]);
    }, 120_000);

    it("leaves stored credentials as they are when no key is set", async () => {
      await seedPlaintextCredentials(2);
      const before = await readOAuthRows();

      const run = await runMigration({});

      expect(run.exitCode).toBe(0);
      expect(run.report).toMatchObject({
        "credential_encryption.skip_reason": "ENCRYPTION_KEY is not set",
        "credential_encryption.status": "skipped",
        level: 30,
      });
      expect(await readOAuthRows()).toEqual(before);
    }, 120_000);

    it("leaves stored credentials as they are and still succeeds when the key cannot be used", async () => {
      await seedPlaintextCredentials(2);
      const before = await readOAuthRows();

      const run = await runMigration({ ENCRYPTION_KEY: UNUSABLE_KEY });

      expect(run.exitCode).toBe(0);
      expect(run.report).toMatchObject({
        "credential_encryption.skip_reason": "ENCRYPTION_KEY must be 32 bytes (base64 encoded)",
        "credential_encryption.status": "skipped",
        level: 40,
      });
      expect(run.printed).not.toContain(UNUSABLE_KEY);
      expect(await readOAuthRows()).toEqual(before);
    }, 120_000);

    it("fails before touching the database when a decrypt-only key cannot be used", async () => {
      await seedPlaintextCredentials(2);
      const before = await readOAuthRows();

      const run = await runMigration({
        DATABASE_URL: "postgres://nobody:connection-password@127.0.0.1:9/none",
        ENCRYPTION_KEY: NEW_KEY,
        ENCRYPTION_KEYS_DECRYPT_ONLY: `${OLD_KEY},${UNUSABLE_KEY}`,
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.report).toBeNull();
      expect(run.printed)
        .toContain("ENCRYPTION_KEYS_DECRYPT_ONLY entry 2 must be 32 bytes (base64 encoded)");
      for (const secret of [OLD_KEY, NEW_KEY, UNUSABLE_KEY, "connection-password"]) {
        expect(run.printed).not.toContain(secret);
      }
      expect(await readOAuthRows()).toEqual(before);
    }, 120_000);

    it("finishes the migration when a row cannot be written, and reports the row as left over", async () => {
      const refusedId = await seedOAuthCredential("refused-access-value", "refused-refresh-value");
      await seedOAuthCredential("written-access", "written-refresh");
      const before = await readOAuthRow(refusedId);

      await withRefusedWrites(refusedId, async () => {
        const run = await runMigration({ ENCRYPTION_KEY: OLD_KEY });

        expect(run.exitCode).toBe(0);
        expect(run.report).toMatchObject({
          "credential_encryption.rows_failed": { "lock-timeout": 1 },
          "credential_encryption.status": "incomplete",
          "credential_encryption.values_converted": 2,
          level: 40,
        });
        expect(run.printed).not.toContain("refused-access-value");
        expect(run.printed).not.toContain("refused-refresh-value");
        expect(run.printed).not.toContain(ENCRYPTED_PREFIX);
      });

      expect(await readOAuthRow(refusedId)).toEqual(before);
    }, 120_000);
  });
});
