import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { createGoogleOAuthService } from "@keeper.sh/calendar";
import { createMicrosoftOAuthService } from "@keeper.sh/calendar";
import { eq } from "drizzle-orm";
import { database, env } from "@/context";
import { resolveOAuthProviderConfig } from "./oauth-provider-config";

const FIRST_RESULT_LIMIT = 1;
const MS_PER_SECOND = 1000;

interface RefreshResult {
  accessToken: string;
  expiresAt: Date;
}

const refreshGoogleAccessToken = async (
  accountId: string,
  refreshToken: string,
): Promise<RefreshResult> => {
  const { clientId, clientSecret } = resolveOAuthProviderConfig(
    "google",
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  );

  const googleOAuth = createGoogleOAuthService({
    clientId,
    clientSecret,
  });

  const tokenData = await googleOAuth.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  const [account] = await database
    .select({ oauthCredentialId: calendarAccountsTable.oauthCredentialId })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(FIRST_RESULT_LIMIT);

  if (account?.oauthCredentialId) {
    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken: tokenData.access_token,
        expiresAt: newExpiresAt,
        refreshToken: tokenData.refresh_token ?? refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, account.oauthCredentialId));
  }

  return {
    accessToken: tokenData.access_token,
    expiresAt: newExpiresAt,
  };
};

const refreshMicrosoftAccessToken = async (
  accountId: string,
  refreshToken: string,
): Promise<RefreshResult> => {
  const { clientId, clientSecret } = resolveOAuthProviderConfig(
    "microsoft",
    env.MICROSOFT_CLIENT_ID,
    env.MICROSOFT_CLIENT_SECRET,
  );

  const microsoftOAuth = createMicrosoftOAuthService({
    clientId,
    clientSecret,
  });

  const tokenData = await microsoftOAuth.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  const [account] = await database
    .select({ oauthCredentialId: calendarAccountsTable.oauthCredentialId })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(FIRST_RESULT_LIMIT);

  if (account?.oauthCredentialId) {
    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken: tokenData.access_token,
        expiresAt: newExpiresAt,
        refreshToken: tokenData.refresh_token ?? refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, account.oauthCredentialId));
  }

  return {
    accessToken: tokenData.access_token,
    expiresAt: newExpiresAt,
  };
};

const refreshGoogleSourceAccessToken = async (
  credentialId: string,
  refreshToken: string,
): Promise<RefreshResult> => {
  const { clientId, clientSecret } = resolveOAuthProviderConfig(
    "google",
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  );

  const googleOAuth = createGoogleOAuthService({
    clientId,
    clientSecret,
  });

  const tokenData = await googleOAuth.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: tokenData.access_token,
      expiresAt: newExpiresAt,
      refreshToken: tokenData.refresh_token ?? refreshToken,
    })
    .where(eq(oauthCredentialsTable.id, credentialId));

  return {
    accessToken: tokenData.access_token,
    expiresAt: newExpiresAt,
  };
};

const refreshMicrosoftSourceAccessToken = async (
  credentialId: string,
  refreshToken: string,
): Promise<RefreshResult> => {
  const { clientId, clientSecret } = resolveOAuthProviderConfig(
    "microsoft",
    env.MICROSOFT_CLIENT_ID,
    env.MICROSOFT_CLIENT_SECRET,
  );

  const microsoftOAuth = createMicrosoftOAuthService({
    clientId,
    clientSecret,
  });

  const tokenData = await microsoftOAuth.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: tokenData.access_token,
      expiresAt: newExpiresAt,
      refreshToken: tokenData.refresh_token ?? refreshToken,
    })
    .where(eq(oauthCredentialsTable.id, credentialId));

  return {
    accessToken: tokenData.access_token,
    expiresAt: newExpiresAt,
  };
};

export {
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
  refreshGoogleSourceAccessToken,
  refreshMicrosoftSourceAccessToken,
};
