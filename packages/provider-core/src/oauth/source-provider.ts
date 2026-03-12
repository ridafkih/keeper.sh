import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
import type { OAuthSourceConfig, SourceEvent, SourceSyncResult } from "../types";
import type { OAuthTokenProvider } from "./provider";
import { isOAuthReauthRequiredError } from "./error-classification";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";

const MS_PER_SECOND = 1000;

interface FetchEventsResult {
  events: SourceEvent[];
  nextSyncToken?: string;
  fullSyncRequired?: boolean;
  isDeltaSync?: boolean;
  cancelledEventUids?: string[];
}

interface ProcessEventsOptions {
  nextSyncToken?: string;
  isDeltaSync?: boolean;
  cancelledEventUids?: string[];
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
      return this.processEvents(fullResult.events, {
        cancelledEventUids: fullResult.cancelledEventUids,
        isDeltaSync: fullResult.isDeltaSync,
        nextSyncToken: fullResult.nextSyncToken,
      });
    }

    const processResult = await this.processEvents(result.events, {
      cancelledEventUids: result.cancelledEventUids,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: result.nextSyncToken,
    });

    if (processResult.fullSyncRequired) {
      const fullResult = await this.fetchEvents(null);
      return this.processEvents(fullResult.events, {
        cancelledEventUids: fullResult.cancelledEventUids,
        isDeltaSync: false,
        nextSyncToken: fullResult.nextSyncToken,
      });
    }

    return processResult;
  }

  protected abstract processEvents(
    events: SourceEvent[],
    options: ProcessEventsOptions,
  ): Promise<SourceSyncResult>;

  protected async clearSyncToken(): Promise<void> {
    const { database, calendarId } = this.config;
    await database
      .update(calendarsTable)
      .set({ syncToken: null })
      .where(eq(calendarsTable.id, calendarId));
  }

  protected async updateSyncToken(syncToken: string): Promise<void> {
    const { database, calendarId } = this.config;
    await database
      .update(calendarsTable)
      .set({ syncToken })
      .where(eq(calendarsTable.id, calendarId));
  }

  protected async markNeedsReauthentication(): Promise<void> {
    const { database, calendarAccountId } = this.config;

    await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: true })
      .where(eq(calendarAccountsTable.id, calendarAccountId));
  }

  protected async ensureValidToken(): Promise<void> {
    const {
      database,
      accessTokenExpiresAt,
      refreshToken,
      oauthCredentialId,
    } = this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const tokenData = await runWithCredentialRefreshLock(oauthCredentialId, async () => {
      try {
        return await this.oauthProvider.refreshAccessToken(refreshToken);
      } catch (error) {
        if (isOAuthReauthRequiredError(error)) {
          await this.markNeedsReauthentication();
        }
        throw error;
      }
    });

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
export type { FetchEventsResult, ProcessEventsOptions };
