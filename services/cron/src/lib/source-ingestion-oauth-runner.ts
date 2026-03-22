import { allSettledWithConcurrency, ensureValidToken } from "@keeper.sh/calendar";
import type { TokenState } from "@keeper.sh/calendar";
import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { runSourceIngestionUnit } from "@keeper.sh/machine-orchestration";
import { and, arrayContains, eq } from "drizzle-orm";
import { database, refreshLockRedis } from "@/context";
import env from "@/env";
import {
  OAuthIngestionResolutionStatus,
  createOAuthIngestionResolutionDependencies,
  resolveOAuthIngestionResolution,
} from "./oauth-ingestion-resolution";
import { resolveSourceIngestionErrorCode } from "./source-ingestion-error-code";
import {
  classifySourceIngestionFailure,
  SourceIngestionFailureLogSlug,
} from "./source-ingestion-failure";
import { resolveSourceIngestionFailurePolicy } from "./source-ingestion-failure-policy";
import { summarizeIngestionSettlements } from "./ingestion-settlement-summary";
import {
  createSourceIngestionLogger,
  createSourceRuntime,
  disableCalendarById,
  ingestWithFetcher,
  markCalendarAccountNeedsReauthById,
  persistCalendarSyncTokenById,
  runIngestionContext,
  SOURCE_CONCURRENCY,
  withTimeout,
  type IngestionSourceResult,
  type SourceIngestionBatchResult,
} from "./source-ingestion-job-helpers";
import { isSourceIngestionNotFoundError } from "./source-ingestion-errors";

const isOAuthAuthFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("authRequired" in error && error.authRequired === true) {
    return true;
  }
  if ("oauthReauthRequired" in error && error.oauthReauthRequired === true) {
    return true;
  }
  return false;
};

const ingestOAuthSources = async (): Promise<SourceIngestionBatchResult> => {
  const oauthResolutionDependencies = createOAuthIngestionResolutionDependencies(refreshLockRedis);
  const oauthSources = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      expiresAt: oauthCredentialsTable.expiresAt,
      externalCalendarId: calendarsTable.externalCalendarId,
      provider: calendarAccountsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
      syncToken: calendarsTable.syncToken,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
      ),
    );

  const settlements = await allSettledWithConcurrency(
    oauthSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        runIngestionContext(() => {
          const sourceRuntime = createSourceRuntime({
            handlers: {
              disableSource: () => disableCalendarById(source.calendarId),
              markNeedsReauth: () => markCalendarAccountNeedsReauthById(source.accountId),
              persistSyncToken: (syncToken) => persistCalendarSyncTokenById(source.calendarId, syncToken),
            },
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
              externalCalendarId: source.externalCalendarId,
              provider: source.provider,
              userId: source.userId,
            },
          });
          const logger = createSourceIngestionLogger();

          return runSourceIngestionUnit({
            classifyFailure: (error) =>
              classifySourceIngestionFailure(
                error,
                {
                  isNotFoundError: isSourceIngestionNotFoundError,
                  resolveErrorCode: resolveSourceIngestionErrorCode,
                },
                {
                  authFailureSlug: SourceIngestionFailureLogSlug.TOKEN_REFRESH_FAILED,
                  isAuthFailure: isOAuthAuthFailure,
                },
              ),
            executeIngest: async () => {
              const resolution = resolveOAuthIngestionResolution({
                accessToken: source.accessToken,
                externalCalendarId: source.externalCalendarId,
                oauthConfig: {
                  googleClientId: env.GOOGLE_CLIENT_ID,
                  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
                  microsoftClientId: env.MICROSOFT_CLIENT_ID,
                  microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
                },
                provider: source.provider,
                syncToken: source.syncToken,
                userId: source.userId,
              }, oauthResolutionDependencies);

              if (resolution.status !== OAuthIngestionResolutionStatus.RESOLVED) {
                return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
              }

              const tokenState: TokenState = {
                accessToken: source.accessToken,
                accessTokenExpiresAt: source.expiresAt,
                refreshToken: source.refreshToken,
              };
              await ensureValidToken(tokenState, resolution.tokenRefresher);

              return ingestWithFetcher({
                calendarId: source.calendarId,
                fetchEvents: () => resolution.fetcher.fetchEvents(),
                provider: source.provider,
              });
            },
            logger,
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
              externalCalendarId: source.externalCalendarId,
              provider: source.provider,
              userId: source.userId,
            },
            resolveFailurePolicy: resolveSourceIngestionFailurePolicy,
            runtime: sourceRuntime,
          });
        }),
      ),
    ),
    { concurrency: SOURCE_CONCURRENCY },
  );

  return summarizeIngestionSettlements(settlements);
};

export {
  ingestOAuthSources,
};
