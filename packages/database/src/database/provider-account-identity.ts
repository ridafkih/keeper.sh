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
      credentialId: calendarAccountsTable.oauthCredentialId,
      provider: calendarAccountsTable.provider,
      userId: calendarAccountsTable.userId,
    })
    .from(calendarAccountsTable)
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

  await transaction.execute(
    sql`update ${calendarAccountsTable} set ${sql.identifier(calendarAccountsTable.oauthCredentialId.name)} = ${holder.credentialId} where ${calendarAccountsTable.oauthCredentialId} = ${target.credentialId} and ${calendarAccountsTable.provider} = ${target.provider} and ${calendarAccountsTable.userId} = ${target.userId}`,
  );

  const [remaining] = await transaction
    .select({ total: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.oauthCredentialId, target.credentialId));

  if (!remaining || remaining.total > NO_REMAINING_ROWS) {
    throw new Error(
      `Oauth credential ${target.credentialId} still carries calendar accounts that do not belong to ${target.provider} for user ${target.userId}, so the duplicate grant behind ${accountRowId} was left in place`,
    );
  }

  await transaction
    .delete(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, target.credentialId));

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
