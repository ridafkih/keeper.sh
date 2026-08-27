import { calendarAccountsTable } from "./schema";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

const calendarRowCarriesAProviderIdentity = (): SQL<boolean> =>
  sql<boolean>`${calendarAccountsTable.accountId} is not null and ${calendarAccountsTable.accountId} <> '' and ${calendarAccountsTable.accountId} <> ${calendarAccountsTable.id}::text`;

const calendarRowProviderIdentity = (): SQL<string | null> =>
  sql<string | null>`case when ${calendarRowCarriesAProviderIdentity()} then ${calendarAccountsTable.accountId} end`;

const adoptsProviderAccountIdentity = (accountRowId: string): SQL =>
  sql`${calendarAccountsTable.id} = ${accountRowId} and not (${calendarRowCarriesAProviderIdentity()})`;

export {
  adoptsProviderAccountIdentity,
  calendarRowCarriesAProviderIdentity,
  calendarRowProviderIdentity,
};
