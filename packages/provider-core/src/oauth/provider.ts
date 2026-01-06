import { calendarDestinationsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
import { CalendarProvider } from "../sync/provider";
import { RateLimiter } from "../utils/rate-limiter";
import type { DeleteResult, OAuthProviderConfig, PushResult, SyncableEvent } from "../types";

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_REQUESTS_PER_MINUTE = 600;
const MS_PER_SECOND = 1000;
const FIRST_RESULT_LIMIT = 1;

interface OAuthRefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface OAuthTokenProvider {
  refreshAccessToken: (refreshToken: string) => Promise<OAuthRefreshResult>;
}

interface AuthErrorResult {
  success: false;
  error: string;
  shouldContinue: false;
}

abstract class OAuthCalendarProvider<
  TConfig extends OAuthProviderConfig = OAuthProviderConfig,
> extends CalendarProvider<TConfig> {
  protected currentAccessToken: string;
  protected abstract oauthProvider: OAuthTokenProvider;
  protected rateLimiter = new RateLimiter({
    concurrency: DEFAULT_CONCURRENCY,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
  });

  constructor(config: TConfig) {
    super(config);
    this.currentAccessToken = config.accessToken;
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    await this.ensureValidToken();

    return Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
          const result = await this.pushEvent(event);
          if (!result.success && this.isRateLimitError(result.error)) {
            this.rateLimiter.reportRateLimit();
          }
          return result;
        }),
      ),
    );
  }

  async deleteEvents(eventIds: string[]): Promise<DeleteResult[]> {
    await this.ensureValidToken();

    return Promise.all(
      eventIds.map((eventId) =>
        this.rateLimiter.execute(async (): Promise<DeleteResult> => {
          const result = await this.deleteEvent(eventId);
          if (!result.success && this.isRateLimitError(result.error)) {
            this.rateLimiter.reportRateLimit();
          }
          return result;
        }),
      ),
    );
  }

  protected abstract pushEvent(event: SyncableEvent): Promise<PushResult>;
  protected abstract deleteEvent(eventId: string): Promise<DeleteResult>;
  protected abstract isRateLimitError(error: string | undefined): boolean;

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

  protected async handleAuthErrorResponse(errorMessage: string): Promise<AuthErrorResult> {
    await this.markNeedsReauthentication();
    return {
      error: errorMessage,
      shouldContinue: false,
      success: false,
    };
  }

  protected async ensureValidToken(): Promise<void> {
    const { database, accessTokenExpiresAt, refreshToken, destinationId } = this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const tokenData = await this.oauthProvider.refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * MS_PER_SECOND);

    const [destination] = await database
      .select({
        oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      })
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

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;
  }
}

export { OAuthCalendarProvider };
export type { OAuthRefreshResult, OAuthTokenProvider, AuthErrorResult };
