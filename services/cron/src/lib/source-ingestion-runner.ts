import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import { ErrorPolicy } from "@keeper.sh/state-machines";
import type { SourceIngestionLifecycleEvent } from "@keeper.sh/state-machines";
import type { SourceIngestionFailureDecision } from "./source-ingestion-failure";

interface SourceIngestionResult {
  eventsAdded: number;
  eventsRemoved: number;
  ingestEvents: Record<string, unknown>[];
}

interface SourceIngestionRuntime {
  dispatch: (event: SourceIngestionLifecycleEvent) => Promise<unknown>;
}

interface SourceIngestionLogger {
  set: (field: string, value: unknown) => void;
  errorFields: (error: unknown, fields: Record<string, unknown>) => void;
  flush: () => void;
  measureDuration: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
}

interface SourceIngestionMetadata {
  userId: string;
  provider: string;
  calendarId: string;
  accountId?: string;
  externalCalendarId?: string | null;
}

interface RunSourceIngestionUnitInput {
  runtime: SourceIngestionRuntime;
  logger: SourceIngestionLogger;
  metadata: SourceIngestionMetadata;
  executeIngest: () => Promise<SourceIngestionResult>;
  classifyFailure: (error: unknown) => SourceIngestionFailureDecision;
  nextSyncToken?: string;
}

const ZERO_RESULT: SourceIngestionResult = {
  eventsAdded: 0,
  eventsRemoved: 0,
  ingestEvents: [],
};

const applyCommonWidelogFields = (
  logger: SourceIngestionLogger,
  metadata: SourceIngestionMetadata,
): void => {
  logger.set("operation.name", "ingest-source");
  logger.set("operation.type", "job");
  logger.set("sync.direction", "ingest");
  logger.set("user.id", metadata.userId);
  logger.set("provider.name", metadata.provider);
  logger.set("provider.calendar_id", metadata.calendarId);

  if (metadata.accountId) {
    logger.set("provider.account_id", metadata.accountId);
  }

  if (metadata.externalCalendarId) {
    logger.set("provider.external_calendar_id", metadata.externalCalendarId);
  }
};

const dispatchIngestionSuccess = async (input: {
  logger: SourceIngestionLogger;
  runtime: SourceIngestionRuntime;
  result: SourceIngestionResult;
  nextSyncToken?: string;
}): Promise<void> => {
  const { logger, runtime, result } = input;
  logger.set("sync.events_added", result.eventsAdded);
  logger.set("sync.events_removed", result.eventsRemoved);

  await runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED });
  await runtime.dispatch({
    eventsAdded: result.eventsAdded,
    eventsRemoved: result.eventsRemoved,
    nextSyncToken: input.nextSyncToken,
    type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
  });

  logger.set("outcome", "success");
};

const runSourceIngestionUnit = async (
  input: RunSourceIngestionUnitInput,
): Promise<SourceIngestionResult> => {
  applyCommonWidelogFields(input.logger, input.metadata);

  try {
    await input.runtime.dispatch({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED });
    await input.runtime.dispatch({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED });

    const result = await input.logger.measureDuration(input.executeIngest);
    await dispatchIngestionSuccess({
      logger: input.logger,
      runtime: input.runtime,
      result,
      nextSyncToken: input.nextSyncToken,
    });
    return result;
  } catch (error) {
    input.logger.set("outcome", "error");
    const failureDecision = input.classifyFailure(error);
    await input.runtime.dispatch({
      code: failureDecision.code,
      type: failureDecision.eventType,
    });
    input.logger.errorFields(error, {
      slug: failureDecision.logSlug,
      policy: failureDecision.policy,
      retriable: failureDecision.policy === ErrorPolicy.RETRYABLE,
      requiresReauth: failureDecision.policy === ErrorPolicy.REQUIRES_REAUTH,
    });
    if (failureDecision.policy === ErrorPolicy.RETRYABLE) {
      throw error;
    }
    return ZERO_RESULT;
  } finally {
    input.logger.flush();
  }
};

export { runSourceIngestionUnit };
export type {
  RunSourceIngestionUnitInput,
  SourceIngestionFailureDecision,
  SourceIngestionLogger,
  SourceIngestionMetadata,
  SourceIngestionResult,
  SourceIngestionRuntime,
};
