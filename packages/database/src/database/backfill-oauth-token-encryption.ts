import { and, count, eq, not, or, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { oauthCredentialsTable } from "./schema";
import {
  ENCRYPTED_TOKEN_MARKER,
  encryptToken,
  isTokenEncrypted,
  storedTokenValue,
} from "../token-encryption";
import type { StoredToken } from "../token-encryption";

const DEFAULT_BACKFILL_BATCH_SIZE = 200;
const UNLIMITED_BATCHES = Number.POSITIVE_INFINITY;

interface OAuthTokenRow {
  id: string;
  accessToken: StoredToken;
  refreshToken: StoredToken;
}

interface OAuthTokenUpdate extends OAuthTokenRow {
  previousAccessToken: StoredToken;
  previousRefreshToken: StoredToken;
}

interface OAuthTokenBackfillDatabase {
  countUnencrypted: () => Promise<number>;
  selectUnencryptedBatch: (batchSize: number) => Promise<OAuthTokenRow[]>;
  writeEncryptedRow: (update: OAuthTokenUpdate) => Promise<boolean>;
}

interface BackfillOptions {
  batchSize?: number;
  dryRun?: boolean;
  maxBatches?: number;
}

interface BackfillResult {
  scanned: number;
  encrypted: number;
  remaining: number;
  dryRun: boolean;
}

const encryptIfPlaintext = (token: StoredToken, encryptionKey: string): StoredToken => {
  if (isTokenEncrypted(token)) {
    return token;
  }
  return encryptToken(storedTokenValue(token), encryptionKey);
};

const planOAuthTokenEncryptionBatch = (
  rows: OAuthTokenRow[],
  encryptionKey: string,
): OAuthTokenUpdate[] => {
  const updates: OAuthTokenUpdate[] = [];

  for (const row of rows) {
    if (isTokenEncrypted(row.accessToken) && isTokenEncrypted(row.refreshToken)) {
      continue;
    }

    updates.push({
      id: row.id,
      accessToken: encryptIfPlaintext(row.accessToken, encryptionKey),
      refreshToken: encryptIfPlaintext(row.refreshToken, encryptionKey),
      previousAccessToken: row.accessToken,
      previousRefreshToken: row.refreshToken,
    });
  }

  return updates;
};

const countUnencryptedOAuthTokens = (
  database: OAuthTokenBackfillDatabase,
): Promise<number> => database.countUnencrypted();

const backfillOAuthTokenEncryption = async (
  database: OAuthTokenBackfillDatabase,
  encryptionKey: string,
  options: BackfillOptions = {},
): Promise<BackfillResult> => {
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required to backfill OAuth token encryption");
  }

  const batchSize = options.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE;
  const dryRun = options.dryRun ?? false;
  const maxBatches = options.maxBatches ?? UNLIMITED_BATCHES;

  let scanned = 0;
  let encrypted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const rows = await database.selectUnencryptedBatch(batchSize);
    if (rows.length === 0) {
      break;
    }

    batches += 1;
    const updates = planOAuthTokenEncryptionBatch(rows, encryptionKey);
    scanned += updates.length;

    if (dryRun) {
      break;
    }

    let appliedInBatch = 0;
    for (const update of updates) {
      const applied = await database.writeEncryptedRow(update);
      if (applied) {
        appliedInBatch += 1;
      }
    }
    encrypted += appliedInBatch;

    if (appliedInBatch === 0) {
      break;
    }
  }

  return {
    scanned,
    encrypted,
    remaining: await database.countUnencrypted(),
    dryRun,
  };
};

const isPlaintextColumn = (column: AnyColumn) =>
  not(sql`${column} LIKE ${`${ENCRYPTED_TOKEN_MARKER}%`}`);

const createOAuthTokenBackfillDatabase = (
  database: NodePgDatabase,
): OAuthTokenBackfillDatabase => ({
  countUnencrypted: async () => {
    const [result] = await database
      .select({ value: count() })
      .from(oauthCredentialsTable)
      .where(
        or(
          isPlaintextColumn(oauthCredentialsTable.accessToken),
          isPlaintextColumn(oauthCredentialsTable.refreshToken),
        ),
      );
    return result?.value ?? 0;
  },
  selectUnencryptedBatch: async (batchSize) => {
    const rows = await database
      .select({
        id: oauthCredentialsTable.id,
        accessToken: oauthCredentialsTable.accessToken,
        refreshToken: oauthCredentialsTable.refreshToken,
      })
      .from(oauthCredentialsTable)
      .where(
        or(
          isPlaintextColumn(oauthCredentialsTable.accessToken),
          isPlaintextColumn(oauthCredentialsTable.refreshToken),
        ),
      )
      .orderBy(oauthCredentialsTable.id)
      .limit(batchSize);

    return rows;
  },
  writeEncryptedRow: async (update) => {
    const applied = await database
      .update(oauthCredentialsTable)
      .set({ accessToken: update.accessToken, refreshToken: update.refreshToken })
      .where(
        and(
          eq(oauthCredentialsTable.id, update.id),
          eq(oauthCredentialsTable.accessToken, update.previousAccessToken),
          eq(oauthCredentialsTable.refreshToken, update.previousRefreshToken),
        ),
      )
      .returning({ id: oauthCredentialsTable.id });

    return applied.length > 0;
  },
});

export {
  backfillOAuthTokenEncryption,
  countUnencryptedOAuthTokens,
  createOAuthTokenBackfillDatabase,
  planOAuthTokenEncryptionBatch,
};
export type {
  BackfillOptions,
  BackfillResult,
  OAuthTokenBackfillDatabase,
  OAuthTokenRow,
  OAuthTokenUpdate,
};
