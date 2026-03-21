import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import type {
  SourceIngestionLifecycleEvent,
  SourceIngestionLifecycleOutput,
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleTransitionResult,
} from "@keeper.sh/state-machines";
import { ErrorPolicy } from "@keeper.sh/state-machines";

interface SourceIngestionResult {
  eventsAdded: number;
  eventsRemoved: number;
  ingestEvents: Record<string, unknown>[];
}

interface SourceIngestionRuntime {
  dispatch: (event: SourceIngestionLifecycleEvent) => Promise<SourceIngestionLifecycleTransitionResult>;
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

interface SourceIngestionFailureDecision {
  eventType:
    | SourceIngestionLifecycleEventType.AUTH_FAILURE
    | SourceIngestionLifecycleEventType.NOT_FOUND
    | SourceIngestionLifecycleEventType.TRANSIENT_FAILURE;
  code: string;
  logSlug: string;
}

interface SourceIngestionFailurePolicy {
  code: string;
  policy: ErrorPolicy;
  retryable: boolean;
  requiresReauth: boolean;
}

interface RunSourceIngestionUnitInput {
  runtime: SourceIngestionRuntime;
  logger: SourceIngestionLogger;
  metadata: SourceIngestionMetadata;
  executeIngest: () => Promise<SourceIngestionResult>;
  classifyFailure: (error: unknown) => SourceIngestionFailureDecision;
  resolveFailurePolicy: (input: {
    outputs: SourceIngestionLifecycleOutput[];
    state: SourceIngestionLifecycleState;
  }) => SourceIngestionFailurePolicy;
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
  logger.set("calendar_sync.id", `${metadata.provider}:${metadata.calendarId}`);

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
    const failureTransition = await input.runtime.dispatch({
      code: failureDecision.code,
      type: failureDecision.eventType,
    });
    const failurePolicy = input.resolveFailurePolicy({
      outputs: failureTransition.outputs,
      state: failureTransition.state,
    });
    input.logger.errorFields(error, {
      slug: failureDecision.logSlug,
      policy: failurePolicy.policy,
      retriable: failurePolicy.retryable,
      requiresReauth: failurePolicy.requiresReauth,
    });
    if (failurePolicy.retryable) {
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
