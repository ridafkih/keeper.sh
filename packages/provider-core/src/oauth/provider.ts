import { calendarAccountsTable, calendarsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { eq } from "drizzle-orm";
import { CalendarProvider } from "../sync/provider";
import { RateLimiter } from "../utils/rate-limiter";
import type { DeleteResult, OAuthProviderConfig, PushResult, SyncableEvent } from "../types";
import { isOAuthReauthRequiredError } from "./error-classification";
import { runWithCredentialRefreshLock } from "./refresh-coordinator";

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_REQUESTS_PER_MINUTE = 600;
const MS_PER_SECOND = 1000;

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

  private async getCalendarAccountId(calendarId: string): Promise<string | null> {
    const [calendar] = await this.config.database
      .select({ accountId: calendarsTable.accountId })
      .from(calendarsTable)
      .where(eq(calendarsTable.id, calendarId))
      .limit(1);

    return calendar?.accountId ?? null;
  }

  private async getOAuthCredentialIdForCalendar(calendarId: string): Promise<string | null> {
    const accountId = await this.getCalendarAccountId(calendarId);
    if (!accountId) {
      return null;
    }

    const [account] = await this.config.database
      .select({ oauthCredentialId: calendarAccountsTable.oauthCredentialId })
      .from(calendarAccountsTable)
      .where(eq(calendarAccountsTable.id, accountId))
      .limit(1);

    return account?.oauthCredentialId ?? null;
  }

  protected async markNeedsReauthentication(): Promise<void> {
    const { database, calendarId, userId, broadcastSyncStatus } = this.config;

    const calendarAccountId = await this.getCalendarAccountId(calendarId);

    if (calendarAccountId) {
      await database
        .update(calendarAccountsTable)
        .set({ needsReauthentication: true })
        .where(eq(calendarAccountsTable.id, calendarAccountId));
    }

    broadcastSyncStatus?.(userId, calendarId, { needsReauthentication: true });
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
    const { database, accessTokenExpiresAt, refreshToken, calendarId } = this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const oauthCredentialId = await this.getOAuthCredentialIdForCalendar(calendarId);
    const lockKey = oauthCredentialId ?? `calendar:${calendarId}`;

    const tokenData = await runWithCredentialRefreshLock(lockKey, async () => {
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

    if (oauthCredentialId) {
      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken: tokenData.access_token,
          expiresAt: newExpiresAt,
          refreshToken: tokenData.refresh_token ?? refreshToken,
        })
        .where(eq(oauthCredentialsTable.id, oauthCredentialId));
    }

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;
  }
}

export { OAuthCalendarProvider };
export type { OAuthRefreshResult, OAuthTokenProvider, AuthErrorResult };
