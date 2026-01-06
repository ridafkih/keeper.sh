import { calendarDestinationsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { createGoogleOAuthService } from "@keeper.sh/oauth-google";
import { eq } from "drizzle-orm";
import { database, env } from "../context";

const FIRST_RESULT_LIMIT = 1;
const MS_PER_SECOND = 1000;

interface RefreshResult {
  accessToken: string;
  expiresAt: Date;
}

const refreshGoogleAccessToken = async (
  destinationId: string,
  refreshToken: string,
): Promise<RefreshResult> => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured");
  }

  const googleOAuth = createGoogleOAuthService({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });

  const tokenData = await googleOAuth.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

  const [destination] = await database
    .select({ oauthCredentialId: calendarDestinationsTable.oauthCredentialId })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.id, destinationId))
    .limit(FIRST_RESULT_LIMIT);

  if (destination?.oauthCredentialId) {
    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken: tokenData.access_token,
        expiresAt: newExpiresAt,
        refreshToken: tokenData.refresh_token ?? refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, destination.oauthCredentialId));
  }

  return {
    accessToken: tokenData.access_token,
    expiresAt: newExpiresAt,
  };
};

export { refreshGoogleAccessToken };
