import {
  allSettledWithConcurrency,
  createIcsSourceFetcher,
} from "@keeper.sh/calendar";
import { calendarsTable } from "@keeper.sh/database/schema";
import { runSourceIngestionUnit } from "@keeper.sh/machine-orchestration";
import { and, eq } from "drizzle-orm";
import { database } from "@/context";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { resolveSourceIngestionErrorCode } from "./source-ingestion-error-code";
import { classifySourceIngestionFailure } from "./source-ingestion-failure";
import { resolveSourceIngestionFailurePolicy } from "./source-ingestion-failure-policy";
import { summarizeIngestionSettlements } from "./ingestion-settlement-summary";
import {
  createSourceIngestionLogger,
  createSourceRuntime,
  disableCalendarById,
  ingestWithFetcher,
  runIngestionContext,
  SOURCE_CONCURRENCY,
  withTimeout,
  type IngestionSourceResult,
  type SourceIngestionBatchResult,
} from "./source-ingestion-job-helpers";
import { isSourceIngestionNotFoundError } from "./source-ingestion-errors";

const ingestIcsSources = async (): Promise<SourceIngestionBatchResult> => {
  const icsSources = await database
    .select({
      calendarId: calendarsTable.id,
      url: calendarsTable.url,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.calendarType, "ical"),
        eq(calendarsTable.disabled, false),
      ),
    );

  const settlements = await allSettledWithConcurrency(
    icsSources.map((source) => () =>
      withTimeout((): Promise<IngestionSourceResult> =>
        runIngestionContext(() => {
          const sourceRuntime = createSourceRuntime({
            handlers: {
              disableSource: () => disableCalendarById(source.calendarId),
              markNeedsReauth: () => Promise.resolve(),
              persistSyncToken: () => Promise.resolve(),
            },
            metadata: {
              calendarId: source.calendarId,
              provider: "ical",
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
              ),
            executeIngest: async () => {
              const sourceUrl = source.url;
              if (!sourceUrl) {
                return { eventsAdded: 0, eventsRemoved: 0, ingestEvents: [] };
              }

              const fetcher = createIcsSourceFetcher({
                calendarId: source.calendarId,
                database,
                safeFetchOptions,
                url: sourceUrl,
              });

              return ingestWithFetcher({
                calendarId: source.calendarId,
                fetchEvents: () => fetcher.fetchEvents(),
                provider: "ical",
              });
            },
            logger,
            metadata: {
              calendarId: source.calendarId,
              provider: "ical",
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
  ingestIcsSources,
};
