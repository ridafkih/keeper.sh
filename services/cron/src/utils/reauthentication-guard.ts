import {
  caldavCredentialsTable,
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

interface UnchangedOAuthCredential {
  oauthCredentialId: string;
  refreshToken: string;
}

interface UnchangedCalDAVCredential {
  caldavCredentialId: string;
  encryptedPassword: string;
}

const oauthCredentialIsUnchanged = (credential: UnchangedOAuthCredential): SQL =>
  sql`${eq(calendarAccountsTable.oauthCredentialId, credential.oauthCredentialId)} and exists (
    select 1 from ${oauthCredentialsTable}
    where ${oauthCredentialsTable.id} = ${credential.oauthCredentialId}
      and ${oauthCredentialsTable.refreshToken} = ${credential.refreshToken}
  )`;

const caldavCredentialIsUnchanged = (credential: UnchangedCalDAVCredential): SQL =>
  sql`${eq(calendarAccountsTable.caldavCredentialId, credential.caldavCredentialId)} and exists (
    select 1 from ${caldavCredentialsTable}
    where ${caldavCredentialsTable.id} = ${credential.caldavCredentialId}
      and ${caldavCredentialsTable.encryptedPassword} = ${credential.encryptedPassword}
  )`;

export { caldavCredentialIsUnchanged, oauthCredentialIsUnchanged };
export type { UnchangedCalDAVCredential, UnchangedOAuthCredential };
