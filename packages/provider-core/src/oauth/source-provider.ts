import {
  calendarDestinationsTable,
  oauthCalendarSourcesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
import type { OAuthSourceConfig, SourceEvent, SourceSyncResult } from "../types";
import type { OAuthTokenProvider } from "./provider";

const MS_PER_SECOND = 1000;

interface FetchEventsResult {
  events: SourceEvent[];
  nextSyncToken?: string;
  fullSyncRequired?: boolean;
}

abstract class OAuthSourceProvider<TConfig extends OAuthSourceConfig = OAuthSourceConfig> {
  abstract readonly name: string;
  abstract readonly providerId: string;

  protected config: TConfig;
  protected currentAccessToken: string;
  protected abstract oauthProvider: OAuthTokenProvider;

  constructor(config: TConfig) {
    this.config = config;
    this.currentAccessToken = config.accessToken;
  }

  abstract fetchEvents(syncToken: string | null): Promise<FetchEventsResult>;

  async sync(): Promise<SourceSyncResult> {
    await this.ensureValidToken();

    const result = await this.fetchEvents(this.config.syncToken);

    if (result.fullSyncRequired) {
      await this.clearSyncToken();
      const fullResult = await this.fetchEvents(null);
      return this.processEvents(fullResult.events, fullResult.nextSyncToken);
    }

    return this.processEvents(result.events, result.nextSyncToken);
  }

  protected abstract processEvents(
    events: SourceEvent[],
    nextSyncToken?: string,
  ): Promise<SourceSyncResult>;

  protected async clearSyncToken(): Promise<void> {
    const { database, sourceId } = this.config;
    await database
      .update(oauthCalendarSourcesTable)
      .set({ syncToken: null })
      .where(eq(oauthCalendarSourcesTable.id, sourceId));
  }

  protected async updateSyncToken(syncToken: string): Promise<void> {
    const { database, sourceId } = this.config;
    await database
      .update(oauthCalendarSourcesTable)
      .set({ syncToken })
      .where(eq(oauthCalendarSourcesTable.id, sourceId));
  }

  protected async markNeedsReauthentication(): Promise<void> {
    const { database, destinationId } = this.config;
    await database
      .update(calendarDestinationsTable)
      .set({ needsReauthentication: true })
      .where(eq(calendarDestinationsTable.id, destinationId));
  }

  protected async ensureValidToken(): Promise<void> {
    const { database, accessTokenExpiresAt, refreshToken, oauthCredentialId } = this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const tokenData = await this.oauthProvider.refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken: tokenData.access_token,
        expiresAt: newExpiresAt,
        refreshToken: tokenData.refresh_token ?? refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, oauthCredentialId));

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;
  }

  protected get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.currentAccessToken}`,
      "Content-Type": "application/json",
    };
  }
}

export { OAuthSourceProvider };
export type { FetchEventsResult };
