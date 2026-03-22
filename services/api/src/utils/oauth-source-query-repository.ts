import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
} from "./oauth-source-errors";
import type { OAuthSourceDatabase } from "./oauth-source-repository";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_CALENDAR_TYPE = "oauth";

interface OAuthCalendarSource {
  id: string;
  name: string;
  provider: string;
  email: string | null;
}

interface OAuthAccountWithCredentials {
  accountId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface OAuthSourceWithCredentials {
  credentialId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getUserOAuthSourcesWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  provider: string,
): Promise<OAuthCalendarSource[]> => {
  const sources = await databaseClient
    .select({
      email: oauthCredentialsTable.email,
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .leftJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, OAUTH_CALENDAR_TYPE),
        eq(calendarAccountsTable.provider, provider),
        inArray(
          calendarsTable.id,
          databaseClient
            .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  return sources;
};

const verifyOAuthSourceOwnershipWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  calendarId: string,
): Promise<boolean> => {
  const [source] = await databaseClient
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, OAUTH_CALENDAR_TYPE),
        inArray(
          calendarsTable.id,
          databaseClient
            .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

const getOAuthDestinationCredentialsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  accountId: string,
  provider: string,
): Promise<OAuthAccountWithCredentials> => {
  const [result] = await databaseClient
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accountId: calendarAccountsTable.id,
      email: calendarAccountsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new DestinationNotFoundError();
  }
  if (result.provider !== provider) {
    throw new DestinationProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    accountId: result.accountId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

const getOAuthSourceCredentialsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  credentialId: string,
  provider: string,
): Promise<OAuthSourceWithCredentials> => {
  const [result] = await databaseClient
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      credentialId: oauthCredentialsTable.id,
      email: oauthCredentialsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: oauthCredentialsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new SourceCredentialNotFoundError();
  }
  if (result.provider !== provider) {
    throw new SourceCredentialProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    credentialId: result.credentialId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

export {
  getUserOAuthSourcesWithDatabase,
  verifyOAuthSourceOwnershipWithDatabase,
  getOAuthDestinationCredentialsWithDatabase,
  getOAuthSourceCredentialsWithDatabase,
};
export type {
  OAuthCalendarSource,
  OAuthAccountWithCredentials,
  OAuthSourceWithCredentials,
};
