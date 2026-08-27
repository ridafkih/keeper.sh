import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { decryptPassword, encryptPassword } from "@keeper.sh/database";
import { user } from "@keeper.sh/database/auth-schema";
import { deletionResidueTable } from "@keeper.sh/database/schema";
import {
  MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION,
  PUSH_CHANNEL_RESIDUE_KIND,
  RESIDUE_LIFETIME_MS,
} from "./teardown-residue";
import type {
  TeardownResidueCredential,
  TeardownResidueDraft,
  TeardownResidueRecord,
  TeardownResidueStore,
} from "./teardown-residue";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

const RETRY_BASE_SECONDS = 300;
const RETRY_CAP_SECONDS = 3600;
const RETRY_BACKOFF_EXPONENT_CAP = 6;
const DEFAULT_RESIDUE_BATCH_LIMIT = 100;

type DeletionResidueRow = typeof deletionResidueTable.$inferSelect;

interface TeardownResidueStoreConfig {
  batchLimit?: number;
  database: PgDatabase<PgQueryResultHKT>;
  encryptionKey: string | null;
  now: () => Date;
}

const requireEncryptionKey = (encryptionKey: string | null): string => {
  if (encryptionKey === null) {
    throw new Error(
      "Teardown residue holds provider credentials and cannot be read or written without ENCRYPTION_KEY",
    );
  }

  return encryptionKey;
};

const encryptOptional = (value: string | null, encryptionKey: string): string | null => {
  if (value === null) {
    return null;
  }

  return encryptPassword(value, encryptionKey);
};

const decryptOptional = (value: string | null, encryptionKey: string): string | null => {
  if (value === null) {
    return null;
  }

  return decryptPassword(value, encryptionKey);
};

const decryptCredential = (
  row: DeletionResidueRow,
  encryptionKey: string | null,
): TeardownResidueCredential | null => {
  if (row.encryptedAccessToken === null) {
    return null;
  }

  const key = requireEncryptionKey(encryptionKey);

  return {
    accessToken: decryptPassword(row.encryptedAccessToken, key),
    expiresAt: row.credentialExpiresAt,
    refreshToken: decryptOptional(row.encryptedRefreshToken, key),
  };
};

const toResidueRecord = (
  row: DeletionResidueRow,
  encryptionKey: string | null,
): TeardownResidueRecord => {
  const credential = decryptCredential(row, encryptionKey);

  return {
    attempts: row.attempts,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    id: row.id,
    kind: row.kind,
    userId: row.userId,
    ...(row.accountEmail !== null && { accountEmail: row.accountEmail }),
    ...(credential !== null && { credential }),
    ...(row.externalId !== null && { externalId: row.externalId }),
    ...(row.provider !== null && { provider: row.provider }),
    ...(row.providerAccountId !== null && { providerAccountId: row.providerAccountId }),
    ...(row.providerChannelId !== null && { providerChannelId: row.providerChannelId }),
    ...(row.providerResourceId !== null && {
      providerResourceId: row.providerResourceId,
    }),
  };
};

const encryptCredential = (
  credential: TeardownResidueCredential | undefined,
  encryptionKey: string | null,
) => {
  if (!credential) {
    return {};
  }

  const key = requireEncryptionKey(encryptionKey);

  return {
    credentialExpiresAt: credential.expiresAt,
    encryptedAccessToken: encryptPassword(credential.accessToken, key),
    encryptedRefreshToken: encryptOptional(credential.refreshToken, key),
  };
};

const userRowExists = () =>
  sql`exists (select 1 from ${user} where ${user.id} = ${deletionResidueTable.userId})`;

const nextAttemptExpression = (claimedAt: Date) =>
  sql`${claimedAt.toISOString()}::timestamptz + least(
    ${sql.raw(String(RETRY_CAP_SECONDS))},
    ${sql.raw(String(RETRY_BASE_SECONDS))} * power(
      2,
      least(${deletionResidueTable.attempts}, ${sql.raw(String(RETRY_BACKOFF_EXPONENT_CAP))})
    )
  ) * interval '1 second'`;

const dueBatch = (claimedAt: Date, batchLimit: number) =>
  sql`${deletionResidueTable.id} in (
    select "due"."id"
    from ${deletionResidueTable} as "due"
    where (
      "due"."nextAttemptAt" is null
      or "due"."nextAttemptAt" <= ${claimedAt.toISOString()}::timestamptz
    )
    and not exists (select 1 from ${user} where ${user.id} = "due"."userId")
    order by "due"."nextAttemptAt" nulls first
    limit ${batchLimit}
    for update skip locked
  )`;

const createTeardownResidueStore = (
  config: TeardownResidueStoreConfig,
): TeardownResidueStore => ({
  clear: async (residueId) => {
    await config.database
      .delete(deletionResidueTable)
      .where(eq(deletionResidueTable.id, residueId));
  },
  delete: async (userId, kind, providerChannelId) => {
    const rows = await config.database
      .delete(deletionResidueTable)
      .where(and(
        eq(deletionResidueTable.userId, userId),
        eq(deletionResidueTable.kind, kind),
        eq(deletionResidueTable.providerChannelId, providerChannelId),
        userRowExists(),
      ))
      .returning({ id: deletionResidueTable.id });

    return rows.length;
  },
  deleteForUser: async (userId, kind) => {
    const rows = await config.database
      .delete(deletionResidueTable)
      .where(and(
        eq(deletionResidueTable.userId, userId),
        eq(deletionResidueTable.kind, kind),
        userRowExists(),
      ))
      .returning({ id: deletionResidueTable.id });

    return rows.length;
  },
  hasUnreapedPushResidue: async (userId: string, provider: string) => {
    const rows = await config.database
      .select({ id: deletionResidueTable.id })
      .from(deletionResidueTable)
      .where(and(
        eq(deletionResidueTable.userId, userId),
        eq(deletionResidueTable.provider, provider),
        eq(deletionResidueTable.kind, PUSH_CHANNEL_RESIDUE_KIND),
        lt(
          deletionResidueTable.attempts,
          MAX_PUSH_REPAIR_ATTEMPTS_BLOCKING_REVOCATION,
        ),
        sql`not ${userRowExists()}`,
      ))
      .limit(1);

    return rows.length > 0;
  },
  list: async () => {
    const claimedAt = config.now();
    const rows = await config.database
      .update(deletionResidueTable)
      .set({
        attempts: sql`${deletionResidueTable.attempts} + 1`,
        lastAttemptAt: claimedAt,
        nextAttemptAt: nextAttemptExpression(claimedAt),
      })
      .where(and(
        or(
          isNull(deletionResidueTable.nextAttemptAt),
          lte(deletionResidueTable.nextAttemptAt, claimedAt),
        ),
        sql`not ${userRowExists()}`,
        dueBatch(claimedAt, config.batchLimit ?? DEFAULT_RESIDUE_BATCH_LIMIT),
      ))
      .returning();

    return rows.map((row) => toResidueRecord(row, config.encryptionKey));
  },
  purgeOrphaned: async (now: Date) => {
    const rows = await config.database
      .delete(deletionResidueTable)
      .where(and(lte(deletionResidueTable.expiresAt, now), userRowExists()))
      .returning({ id: deletionResidueTable.id });

    return rows.map((row) => row.id);
  },
  record: async (draft: TeardownResidueDraft) => {
    const recordedAt = config.now();

    await config.database.insert(deletionResidueTable).values({
      createdAt: recordedAt,
      expiresAt: new Date(recordedAt.getTime() + RESIDUE_LIFETIME_MS),
      kind: draft.kind,
      userId: draft.userId,
      ...(typeof draft.accountEmail === "string" && { accountEmail: draft.accountEmail }),
      ...encryptCredential(draft.credential, config.encryptionKey),
      ...(typeof draft.externalId === "string" && { externalId: draft.externalId }),
      ...(typeof draft.provider === "string" && { provider: draft.provider }),
      ...(typeof draft.providerAccountId === "string" && {
        providerAccountId: draft.providerAccountId,
      }),
      ...(typeof draft.providerChannelId === "string" && {
        providerChannelId: draft.providerChannelId,
      }),
      ...(typeof draft.providerResourceId === "string" && {
        providerResourceId: draft.providerResourceId,
      }),
    });
  },
});

export { createTeardownResidueStore };
export type { TeardownResidueStoreConfig };
