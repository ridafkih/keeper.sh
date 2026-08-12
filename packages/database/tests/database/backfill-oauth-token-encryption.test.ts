import { describe, expect, it } from "vitest";
import {
  backfillOAuthTokenEncryption,
  countUnencryptedOAuthTokens,
  planOAuthTokenEncryptionBatch,
} from "../../src/database/backfill-oauth-token-encryption";
import type { OAuthTokenBackfillDatabase } from "../../src/database/backfill-oauth-token-encryption";
import {
  decryptToken,
  isTokenEncrypted,
  readStoredToken,
  storedTokenValue,
} from "../../src/token-encryption";

const KEY = Buffer.from(new Uint8Array(32).fill(11)).toString("base64");
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(12)).toString("base64");

interface Row {
  id: string;
  accessToken: string;
  refreshToken: string;
}

const createFakeDatabase = (
  rows: Row[],
  options: { failOnRowId?: string } = {},
): { database: OAuthTokenBackfillDatabase; rows: Row[]; writeCount: number } => {
  const state = { writeCount: 0 };

  const database: OAuthTokenBackfillDatabase = {
    countUnencrypted: () =>
      Promise.resolve(
        rows.filter(
          (row) =>
            !isTokenEncrypted(readStoredToken(row.accessToken))
            || !isTokenEncrypted(readStoredToken(row.refreshToken)),
        ).length,
      ),
    selectUnencryptedBatch: (batchSize) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              !isTokenEncrypted(readStoredToken(row.accessToken))
              || !isTokenEncrypted(readStoredToken(row.refreshToken)),
          )
          .slice(0, batchSize)
          .map((row) => ({
            id: row.id,
            accessToken: readStoredToken(row.accessToken),
            refreshToken: readStoredToken(row.refreshToken),
          })),
      ),
    writeEncryptedRow: (update) => {
      if (options.failOnRowId === update.id) {
        return Promise.reject(new Error("interrupted"));
      }
      const row = rows.find((candidate) => candidate.id === update.id);
      if (!row) {
        return Promise.reject(new Error(`Unknown row ${update.id}`));
      }
      if (
        row.accessToken !== storedTokenValue(update.previousAccessToken)
        || row.refreshToken !== storedTokenValue(update.previousRefreshToken)
      ) {
        return Promise.resolve(false);
      }
      state.writeCount += 1;
      row.accessToken = storedTokenValue(update.accessToken);
      row.refreshToken = storedTokenValue(update.refreshToken);
      return Promise.resolve(true);
    },
  };

  return {
    database,
    rows,
    get writeCount() {
      return state.writeCount;
    },
  };
};

describe("planOAuthTokenEncryptionBatch", () => {
  it("encrypts only the columns that are still plaintext", () => {
    const alreadyEncrypted = storedTokenValue(
      planOAuthTokenEncryptionBatch(
        [{ id: "a", accessToken: readStoredToken("x"), refreshToken: readStoredToken("y") }],
        KEY,
      )[0]?.accessToken ?? readStoredToken(""),
    );

    const plan = planOAuthTokenEncryptionBatch(
      [
        {
          id: "a",
          accessToken: readStoredToken(alreadyEncrypted),
          refreshToken: readStoredToken("still-plain"),
        },
      ],
      KEY,
    );

    expect(plan).toHaveLength(1);
    expect(storedTokenValue(plan[0]?.accessToken ?? readStoredToken(""))).toBe(alreadyEncrypted);
    expect(isTokenEncrypted(plan[0]?.refreshToken ?? readStoredToken(""))).toBe(true);
  });

  it("skips rows where both columns are already encrypted", () => {
    const encrypted = planOAuthTokenEncryptionBatch(
      [{ id: "a", accessToken: readStoredToken("x"), refreshToken: readStoredToken("y") }],
      KEY,
    );

    const plan = planOAuthTokenEncryptionBatch(
      [
        {
          id: "a",
          accessToken: encrypted[0]?.accessToken ?? readStoredToken(""),
          refreshToken: encrypted[0]?.refreshToken ?? readStoredToken(""),
        },
      ],
      KEY,
    );

    expect(plan).toEqual([]);
  });
});

describe("backfillOAuthTokenEncryption", () => {
  it("encrypts every plaintext row and leaves them readable", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
    ]);

    const result = await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 1 });

    expect(result).toEqual({ scanned: 2, encrypted: 2, remaining: 0, dryRun: false });
    for (const row of fake.rows) {
      expect(isTokenEncrypted(readStoredToken(row.accessToken))).toBe(true);
      expect(isTokenEncrypted(readStoredToken(row.refreshToken))).toBe(true);
    }
    expect(decryptToken(readStoredToken(fake.rows[0]?.accessToken ?? ""), KEY)).toBe("access-1");
    expect(decryptToken(readStoredToken(fake.rows[1]?.refreshToken ?? ""), KEY)).toBe("refresh-2");
  });

  it("is idempotent: a second run changes nothing and does not double encrypt", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
    ]);

    await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 10 });
    const afterFirstRun = { ...fake.rows[0] };
    const writesAfterFirstRun = fake.writeCount;

    const second = await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 10 });

    expect(second).toEqual({ scanned: 0, encrypted: 0, remaining: 0, dryRun: false });
    expect(fake.rows[0]).toEqual(afterFirstRun);
    expect(fake.writeCount).toBe(writesAfterFirstRun);
    expect(decryptToken(readStoredToken(fake.rows[0]?.accessToken ?? ""), KEY)).toBe("access-1");
  });

  it("reports what it would change in dry-run mode without writing", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
    ]);

    const result = await backfillOAuthTokenEncryption(fake.database, KEY, {
      batchSize: 10,
      dryRun: true,
    });

    expect(result).toEqual({ scanned: 2, encrypted: 0, remaining: 2, dryRun: true });
    expect(fake.writeCount).toBe(0);
    expect(fake.rows[0]?.accessToken).toBe("access-1");
  });

  it("leaves migrated and unmigrated rows readable when interrupted partway", async () => {
    const fake = createFakeDatabase(
      [
        { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
        { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
        { id: "3", accessToken: "access-3", refreshToken: "refresh-3" },
      ],
      { failOnRowId: "2" },
    );

    await expect(
      backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 1 }),
    ).rejects.toThrow("interrupted");

    expect(decryptToken(readStoredToken(fake.rows[0]?.accessToken ?? ""), KEY)).toBe("access-1");
    expect(decryptToken(readStoredToken(fake.rows[1]?.accessToken ?? ""), KEY)).toBe("access-2");
    expect(decryptToken(readStoredToken(fake.rows[2]?.accessToken ?? ""), KEY)).toBe("access-3");
    expect(isTokenEncrypted(readStoredToken(fake.rows[0]?.accessToken ?? ""))).toBe(true);
    expect(isTokenEncrypted(readStoredToken(fake.rows[1]?.accessToken ?? ""))).toBe(false);
  });

  it("resumes from where an interrupted run stopped", async () => {
    const rows = [
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
      { id: "3", accessToken: "access-3", refreshToken: "refresh-3" },
    ];
    const failing = createFakeDatabase(rows, { failOnRowId: "2" });

    await expect(
      backfillOAuthTokenEncryption(failing.database, KEY, { batchSize: 1 }),
    ).rejects.toThrow("interrupted");

    const resumed = createFakeDatabase(rows);
    const result = await backfillOAuthTokenEncryption(resumed.database, KEY, { batchSize: 10 });

    expect(result).toEqual({ scanned: 2, encrypted: 2, remaining: 0, dryRun: false });
    expect(resumed.writeCount).toBe(2);
    expect(decryptToken(readStoredToken(rows[0]?.accessToken ?? ""), KEY)).toBe("access-1");
    expect(decryptToken(readStoredToken(rows[2]?.accessToken ?? ""), KEY)).toBe("access-3");
  });

  it("does not overwrite a token that a concurrent refresh encrypted mid-run", async () => {
    const rows = [
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
    ];
    const fake = createFakeDatabase(rows);

    const [refreshed] = planOAuthTokenEncryptionBatch(
      [
        {
          id: "2",
          accessToken: readStoredToken("access-2-refreshed"),
          refreshToken: readStoredToken("refresh-2-refreshed"),
        },
      ],
      KEY,
    );
    rows[1] = {
      id: "2",
      accessToken: storedTokenValue(refreshed?.accessToken ?? readStoredToken("")),
      refreshToken: storedTokenValue(refreshed?.refreshToken ?? readStoredToken("")),
    };

    const result = await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 10 });

    expect(result.encrypted).toBe(1);
    expect(decryptToken(readStoredToken(rows[1]?.accessToken ?? ""), KEY)).toBe("access-2-refreshed");
    expect(decryptToken(readStoredToken(rows[0]?.accessToken ?? ""), KEY)).toBe("access-1");
  });

  it("skips the write when a concurrent refresh changed the row after it was selected", async () => {
    const rows = [{ id: "1", accessToken: "access-1", refreshToken: "refresh-1" }];
    const fake = createFakeDatabase(rows);
    const original = fake.database.selectUnencryptedBatch;
    fake.database.selectUnencryptedBatch = async (batchSize) => {
      const batch = await original(batchSize);
      if (batch.length > 0) {
        rows[0] = {
          id: "1",
          accessToken: "access-1-refreshed",
          refreshToken: "refresh-1-refreshed",
        };
      }
      return batch;
    };

    const result = await backfillOAuthTokenEncryption(fake.database, KEY, {
      batchSize: 10,
      maxBatches: 1,
    });

    expect(result.encrypted).toBe(0);
    expect(rows[0]?.accessToken).toBe("access-1-refreshed");
  });

  it("refuses to run without an encryption key", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
    ]);

    await expect(
      backfillOAuthTokenEncryption(fake.database, "", { batchSize: 10 }),
    ).rejects.toThrow("ENCRYPTION_KEY");
    expect(fake.writeCount).toBe(0);
  });

  it("fails loudly and writes nothing when the configured key does not match existing ciphertext", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
    ]);
    await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 10 });
    const encryptedRow = { ...fake.rows[0] };

    const rotated = createFakeDatabase([
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
    ]);
    await backfillOAuthTokenEncryption(rotated.database, OTHER_KEY, { batchSize: 10 });

    expect(() =>
      decryptToken(readStoredToken(encryptedRow.accessToken ?? ""), OTHER_KEY),
    ).toThrow();
  });
});

describe("countUnencryptedOAuthTokens", () => {
  it("reports how many rows still hold plaintext", async () => {
    const fake = createFakeDatabase([
      { id: "1", accessToken: "access-1", refreshToken: "refresh-1" },
      { id: "2", accessToken: "access-2", refreshToken: "refresh-2" },
    ]);

    expect(await countUnencryptedOAuthTokens(fake.database)).toBe(2);

    await backfillOAuthTokenEncryption(fake.database, KEY, { batchSize: 10 });

    expect(await countUnencryptedOAuthTokens(fake.database)).toBe(0);
  });
});
