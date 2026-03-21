import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import {
  mapSourceIngestionFailureEventToErrorCode,
  SourceIngestionErrorCode,
} from "./source-ingestion-error-code";

enum SourceIngestionFailureLogSlug {
  AUTH_FAILED = "provider-auth-failed",
  TOKEN_REFRESH_FAILED = "provider-token-refresh-failed",
  NOT_FOUND = "provider-calendar-not-found",
  TRANSIENT = "provider-api-error",
}

interface SourceIngestionFailureDecision {
  eventType:
    | SourceIngestionLifecycleEventType.AUTH_FAILURE
    | SourceIngestionLifecycleEventType.NOT_FOUND
    | SourceIngestionLifecycleEventType.TRANSIENT_FAILURE;
  code: SourceIngestionErrorCode;
  logSlug: SourceIngestionFailureLogSlug;
}

interface SourceIngestionFailureClassifierOptions {
  authFailureSlug?: SourceIngestionFailureLogSlug;
  isAuthFailure?: (error: unknown) => boolean;
}

interface SourceIngestionFailureClassifierDependencies {
  isNotFoundError: (error: unknown) => boolean;
  resolveErrorCode: (error: unknown) => SourceIngestionErrorCode;
}

const classifySourceIngestionFailure = (
  error: unknown,
  dependencies: SourceIngestionFailureClassifierDependencies,
  options?: SourceIngestionFailureClassifierOptions,
): SourceIngestionFailureDecision => {
  if (options?.isAuthFailure?.(error)) {
    return {
      eventType: SourceIngestionLifecycleEventType.AUTH_FAILURE,
      code: mapSourceIngestionFailureEventToErrorCode(
        SourceIngestionLifecycleEventType.AUTH_FAILURE,
      ),
      logSlug: options.authFailureSlug ?? SourceIngestionFailureLogSlug.AUTH_FAILED,
    };
  }

  if (dependencies.isNotFoundError(error)) {
    return {
      eventType: SourceIngestionLifecycleEventType.NOT_FOUND,
      code: mapSourceIngestionFailureEventToErrorCode(
        SourceIngestionLifecycleEventType.NOT_FOUND,
      ),
      logSlug: SourceIngestionFailureLogSlug.NOT_FOUND,
    };
  }

  return {
    eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
    code: dependencies.resolveErrorCode(error),
    logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
  };
};

export { classifySourceIngestionFailure, SourceIngestionFailureLogSlug };
export type {
  SourceIngestionFailureClassifierDependencies,
  SourceIngestionFailureClassifierOptions,
  SourceIngestionFailureDecision,
};
