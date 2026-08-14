import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { database } from "@/context";
import { clearSourceReauthentication } from "./source-reauthentication";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

type CredentialTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

interface CreateOAuthSourceCredentialData {
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const findSourceCredentialId = async (
  transaction: CredentialTransaction,
  userId: string,
  provider: string,
  email: string | null,
): Promise<string | undefined> => {
  const candidates = await transaction
    .select({
      id: oauthCredentialsTable.id,
      sourceAccountId: calendarAccountsTable.id,
    })
    .from(oauthCredentialsTable)
    .leftJoin(
      calendarAccountsTable,
      and(
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        isNull(calendarAccountsTable.accountId),
      ),
    )
    .where(
      and(
        eq(oauthCredentialsTable.userId, userId),
        eq(oauthCredentialsTable.provider, provider),
        eq(oauthCredentialsTable.email, email ?? ""),
      ),
    )
    .orderBy(oauthCredentialsTable.createdAt, oauthCredentialsTable.id);

  const sourceCandidate = candidates.find(({ sourceAccountId }) => sourceAccountId !== null);

  return (sourceCandidate ?? candidates[0])?.id;
};

const createOAuthSourceCredential = (
  userId: string,
  data: CreateOAuthSourceCredentialData,
): Promise<string> =>
  database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const existingId = await findSourceCredentialId(
      transaction,
      userId,
      data.provider,
      data.email,
    );

    if (existingId) {
      await transaction
        .update(oauthCredentialsTable)
        .set({
          accessToken: data.accessToken,
          expiresAt: data.expiresAt,
          needsReauthentication: false,
          refreshToken: data.refreshToken,
        })
        .where(eq(oauthCredentialsTable.id, existingId));

      await clearSourceReauthentication(transaction, existingId);

      return existingId;
    }

    const [credential] = await transaction
      .insert(oauthCredentialsTable)
      .values({
        accessToken: data.accessToken,
        email: data.email,
        expiresAt: data.expiresAt,
        provider: data.provider,
        refreshToken: data.refreshToken,
        userId,
      })
      .returning({ id: oauthCredentialsTable.id });

    if (!credential) {
      throw new Error("Failed to create OAuth source credential");
    }

    return credential.id;
  });

export { createOAuthSourceCredential };
