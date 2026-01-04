import {
  oauthCredentialsTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
import { CalendarProvider } from "./provider";
import type { OAuthProviderConfig } from "./types";

export interface OAuthRefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface OAuthTokenProvider {
  refreshAccessToken: (refreshToken: string) => Promise<OAuthRefreshResult>;
}

export abstract class OAuthCalendarProvider<
  TConfig extends OAuthProviderConfig = OAuthProviderConfig,
> extends CalendarProvider<TConfig> {
  protected currentAccessToken: string;
  protected abstract oauthProvider: OAuthTokenProvider;

  constructor(config: TConfig) {
    super(config);
    this.currentAccessToken = config.accessToken;
  }

  protected get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.currentAccessToken}`,
      "Content-Type": "application/json",
    };
  }

  protected async markNeedsReauthentication(): Promise<void> {
    const { database, destinationId, userId, broadcastSyncStatus } = this.config;
    await database
      .update(calendarDestinationsTable)
      .set({ needsReauthentication: true })
      .where(eq(calendarDestinationsTable.id, destinationId));

    broadcastSyncStatus?.(userId, destinationId, { needsReauthentication: true });
  }

  protected async ensureValidToken(): Promise<void> {
    const { database, accessTokenExpiresAt, refreshToken, destinationId } =
      this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const tokenData = await this.oauthProvider.refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    const [destination] = await database
      .select({
        oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      })
      .from(calendarDestinationsTable)
      .where(eq(calendarDestinationsTable.id, destinationId))
      .limit(1);

    if (destination?.oauthCredentialId) {
      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token ?? refreshToken,
          expiresAt: newExpiresAt,
        })
        .where(eq(oauthCredentialsTable.id, destination.oauthCredentialId));
    }

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;
  }
}
