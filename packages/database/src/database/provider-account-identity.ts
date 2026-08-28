import { calendarAccountsTable, oauthCredentialsTable } from "./schema";
import { and, count, eq, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

const NO_REMAINING_ROWS = 0;

type ProviderAccountIdentityOutcome = "adopted" | "merged" | "retained";

type ProviderAccountIdentityTransaction = Parameters<
  Parameters<PgDatabase<PgQueryResultHKT>["transaction"]>[0]
>[0];

interface ProviderAccountIdentityReconciliation {
  accountRowId: string;
  adopt: (unclaimedIdentity: SQL) => Promise<unknown>;
  database: PgDatabase<PgQueryResultHKT>;
  providerAccountId: string;
}

interface IdentityHolder {
  credentialId: string | null;
  id: string;
}

interface CredentialUsability {
  createdAt: Date;
  credentialId: string;
  expiresAt: Date;
  needsReauthentication: boolean;
}

interface CredentialLifetimeRow {
  createdAt: Date | null;
  expiresAt: Date | null;
  needsReauthentication: boolean | null;
}

const credentialUsability = (
  credentialId: string,
  lifetime: CredentialLifetimeRow,
  owner: string,
): CredentialUsability => {
  if (
    lifetime.createdAt === null
    || lifetime.expiresAt === null
    || lifetime.needsReauthentication === null
  ) {
    throw new Error(
      `Oauth credential ${credentialId} behind ${owner} is missing the lifetime fields needed to choose which duplicate grant survives`,
    );
  }

  return {
    createdAt: lifetime.createdAt,
    credentialId,
    expiresAt: lifetime.expiresAt,
    needsReauthentication: lifetime.needsReauthentication,
  };
};

const moreUsableCredential = (
  left: CredentialUsability,
  right: CredentialUsability,
): CredentialUsability => {
  if (left.needsReauthentication !== right.needsReauthentication) {
    if (left.needsReauthentication) {
      return right;
    }

    return left;
  }

  if (left.expiresAt.getTime() !== right.expiresAt.getTime()) {
    if (left.expiresAt.getTime() > right.expiresAt.getTime()) {
      return left;
    }

    return right;
  }

  if (left.createdAt.getTime() >= right.createdAt.getTime()) {
    return left;
  }

  return right;
};

const orderCredentialsByUsability = (
  left: CredentialUsability,
  right: CredentialUsability,
): { loser: CredentialUsability; survivor: CredentialUsability } => {
  const survivor = moreUsableCredential(left, right);

  if (survivor.credentialId === left.credentialId) {
    return { loser: right, survivor };
  }

  return { loser: left, survivor };
};

const calendarRowCarriesAProviderIdentity = (): SQL<boolean> =>
  sql<boolean>`${calendarAccountsTable.accountId} is not null and ${calendarAccountsTable.accountId} <> '' and ${calendarAccountsTable.accountId} <> ${calendarAccountsTable.id}::text`;

const calendarRowProviderIdentity = (): SQL<string | null> =>
  sql<string | null>`case when ${calendarRowCarriesAProviderIdentity()} then ${calendarAccountsTable.accountId} end`;

const adoptsProviderAccountIdentity = (accountRowId: string): SQL =>
  sql`${calendarAccountsTable.id} = ${accountRowId} and not (${calendarRowCarriesAProviderIdentity()})`;

const noSiblingRowHoldsTheIdentity = (
  accountRowId: string,
  providerAccountId: string,
): SQL => {
  const siblingRow = sql.identifier("sibling_calendar_account");

  return sql`not exists (select 1 from ${calendarAccountsTable} ${siblingRow} where ${siblingRow}.${sql.identifier(calendarAccountsTable.userId.name)} = ${calendarAccountsTable.userId} and ${siblingRow}.${sql.identifier(calendarAccountsTable.provider.name)} = ${calendarAccountsTable.provider} and ${siblingRow}.${sql.identifier(calendarAccountsTable.accountId.name)} = ${providerAccountId} and ${siblingRow}.${sql.identifier(calendarAccountsTable.id.name)} <> ${accountRowId})`;
};

const adoptsUnclaimedProviderAccountIdentity = (
  accountRowId: string,
  providerAccountId: string,
): SQL =>
  sql`${adoptsProviderAccountIdentity(accountRowId)} and ${noSiblingRowHoldsTheIdentity(accountRowId, providerAccountId)}`;

const findIdentityHolder = async (
  database: PgDatabase<PgQueryResultHKT>,
  accountRowId: string,
  providerAccountId: string,
): Promise<IdentityHolder | null> => {
  const holderRow = alias(calendarAccountsTable, "holder_calendar_account");
  const targetRow = alias(calendarAccountsTable, "target_calendar_account");

  const [holder] = await database
    .select({ credentialId: holderRow.oauthCredentialId, id: holderRow.id })
    .from(holderRow)
    .innerJoin(
      targetRow,
      and(
        eq(targetRow.provider, holderRow.provider),
        eq(targetRow.userId, holderRow.userId),
      ),
    )
    .where(
      and(
        eq(holderRow.accountId, providerAccountId),
        eq(targetRow.id, accountRowId),
        ne(holderRow.id, accountRowId),
      ),
    );

  return holder ?? null;
};

const mergeOntoIdentityHolder = async (
  transaction: ProviderAccountIdentityTransaction,
  accountRowId: string,
  holder: IdentityHolder,
): Promise<ProviderAccountIdentityOutcome> => {
  const [target] = await transaction
    .select({
      carriesIdentity: calendarRowCarriesAProviderIdentity(),
      createdAt: oauthCredentialsTable.createdAt,
      credentialId: calendarAccountsTable.oauthCredentialId,
      expiresAt: oauthCredentialsTable.expiresAt,
      needsReauthentication: oauthCredentialsTable.needsReauthentication,
      provider: calendarAccountsTable.provider,
      userId: calendarAccountsTable.userId,
    })
    .from(calendarAccountsTable)
    .leftJoin(
      oauthCredentialsTable,
      eq(oauthCredentialsTable.id, calendarAccountsTable.oauthCredentialId),
    )
    .where(eq(calendarAccountsTable.id, accountRowId));

  if (!target) {
    throw new Error(
      `Calendar account ${accountRowId} disappeared while its provider identity was being reconciled onto ${holder.id}`,
    );
  }

  if (target.carriesIdentity || target.credentialId === null) {
    return "retained";
  }

  if (holder.credentialId === null) {
    throw new Error(
      `Calendar account ${holder.id} already holds the provider identity resolved for ${accountRowId} but carries no oauth credential, so the duplicate grant behind ${accountRowId} cannot be merged onto it`,
    );
  }

  if (holder.credentialId === target.credentialId) {
    return "retained";
  }

  const [holderCredential] = await transaction
    .select({
      createdAt: oauthCredentialsTable.createdAt,
      expiresAt: oauthCredentialsTable.expiresAt,
      needsReauthentication: oauthCredentialsTable.needsReauthentication,
      provider: oauthCredentialsTable.provider,
      userId: oauthCredentialsTable.userId,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, holder.credentialId));

  if (
    !holderCredential
    || holderCredential.userId !== target.userId
    || holderCredential.provider !== target.provider
  ) {
    throw new Error(
      `Oauth credential ${holder.credentialId} behind calendar account ${holder.id} does not belong to ${target.provider} for user ${target.userId}, so the duplicate grant behind ${accountRowId} cannot be merged onto it`,
    );
  }

  const holderUsability = credentialUsability(
    holder.credentialId,
    holderCredential,
    `calendar account ${holder.id}`,
  );
  const targetUsability = credentialUsability(
    target.credentialId,
    target,
    `calendar account ${accountRowId}`,
  );
  const { loser, survivor } = orderCredentialsByUsability(
    holderUsability,
    targetUsability,
  );

  await transaction.execute(
    sql`update ${calendarAccountsTable} set ${sql.identifier(calendarAccountsTable.oauthCredentialId.name)} = ${survivor.credentialId} where ${calendarAccountsTable.oauthCredentialId} = ${loser.credentialId} and ${calendarAccountsTable.provider} = ${target.provider} and ${calendarAccountsTable.userId} = ${target.userId}`,
  );

  const [remaining] = await transaction
    .select({ total: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.oauthCredentialId, loser.credentialId));

  if (!remaining || remaining.total > NO_REMAINING_ROWS) {
    throw new Error(
      `Oauth credential ${loser.credentialId} still carries calendar accounts that do not belong to ${target.provider} for user ${target.userId}, so the duplicate grant behind ${accountRowId} was left in place`,
    );
  }

  await transaction
    .delete(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, loser.credentialId));

  return "merged";
};

const reconcileProviderAccountIdentity = async ({
  accountRowId,
  adopt,
  database,
  providerAccountId,
}: ProviderAccountIdentityReconciliation): Promise<ProviderAccountIdentityOutcome> => {
  const holder = await findIdentityHolder(database, accountRowId, providerAccountId);

  if (!holder) {
    await adopt(adoptsUnclaimedProviderAccountIdentity(accountRowId, providerAccountId));

    return "adopted";
  }

  return database.transaction((transaction) =>
    mergeOntoIdentityHolder(transaction, accountRowId, holder),
  );
};

export {
  adoptsProviderAccountIdentity,
  adoptsUnclaimedProviderAccountIdentity,
  calendarRowCarriesAProviderIdentity,
  calendarRowProviderIdentity,
  reconcileProviderAccountIdentity,
};
export type { ProviderAccountIdentityOutcome };
