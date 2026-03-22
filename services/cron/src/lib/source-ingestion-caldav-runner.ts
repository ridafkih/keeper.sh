import {
  allSettledWithConcurrency,
  createCalDAVSourceFetcher,
  isCalDAVAuthenticationError,
} from "@keeper.sh/calendar";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
} from "@keeper.sh/database/schema";
import { runSourceIngestionUnit } from "@keeper.sh/machine-orchestration";
import { and, arrayContains, eq } from "drizzle-orm";
import { database } from "@/context";
import env from "@/env";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
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
  emptySourceIngestionBatchResult,
  ingestWithFetcher,
  markCalendarAccountNeedsReauthById,
  runIngestionContext,
  SOURCE_CONCURRENCY,
  withTimeout,
  type IngestionSourceResult,
  type SourceIngestionBatchResult,
} from "./source-ingestion-job-helpers";
import { isSourceIngestionNotFoundError } from "./source-ingestion-errors";

const ingestCalDAVSources = async (): Promise<SourceIngestionBatchResult> => {
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    return emptySourceIngestionBatchResult();
  }

  const caldavSources = await database
    .select({
      accountId: calendarAccountsTable.id,
      calendarId: calendarsTable.id,
      calendarUrl: calendarsTable.calendarUrl,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      provider: calendarAccountsTable.provider,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarsTable.userId,
      username: caldavCredentialsTable.username,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(caldavCredentialsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .where(
      and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
      ),
    );

  const settlements = await allSettledWithConcurrency(
    caldavSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        runIngestionContext(() => {
          const sourceRuntime = createSourceRuntime({
            handlers: {
              disableSource: () => disableCalendarById(source.calendarId),
              markNeedsReauth: () => markCalendarAccountNeedsReauthById(source.accountId),
              persistSyncToken: () => Promise.resolve(),
            },
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
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
                  authFailureSlug: SourceIngestionFailureLogSlug.AUTH_FAILED,
                  isAuthFailure: isCalDAVAuthenticationError,
                },
              ),
            executeIngest: async () => {
              const password = decryptPassword(source.encryptedPassword, encryptionKey);
              const calendarUrl = source.calendarUrl ?? source.serverUrl;
              const fetcher = createCalDAVSourceFetcher({
                calendarUrl,
                password,
                safeFetchOptions,
                serverUrl: source.serverUrl,
                username: source.username,
              });

              return ingestWithFetcher({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                provider: source.provider,
              });
            },
            logger,
            metadata: {
              accountId: source.accountId,
              calendarId: source.calendarId,
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
  ingestCalDAVSources,
};
