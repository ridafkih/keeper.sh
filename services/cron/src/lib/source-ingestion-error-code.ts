import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";

enum SourceIngestionErrorCode {
  AUTH_REQUIRED = "auth_required",
  NOT_FOUND = "not_found",
  TIMEOUT = "timeout",
  TRANSIENT_FAILURE = "transient_failure",
  UNKNOWN_ERROR = "unknown_error",
}

type SourceIngestionFailureEventType =
  | SourceIngestionLifecycleEventType.AUTH_FAILURE
  | SourceIngestionLifecycleEventType.NOT_FOUND
  | SourceIngestionLifecycleEventType.TRANSIENT_FAILURE;

const sourceIngestionFailureCodeByEventType: Record<
  SourceIngestionFailureEventType,
  SourceIngestionErrorCode
> = {
  [SourceIngestionLifecycleEventType.AUTH_FAILURE]: SourceIngestionErrorCode.AUTH_REQUIRED,
  [SourceIngestionLifecycleEventType.NOT_FOUND]: SourceIngestionErrorCode.NOT_FOUND,
  [SourceIngestionLifecycleEventType.TRANSIENT_FAILURE]: SourceIngestionErrorCode.TRANSIENT_FAILURE,
};

const sourceIngestionErrorCodeSet = new Set<SourceIngestionErrorCode>(
  Object.values(SourceIngestionErrorCode),
);

const mapSourceIngestionFailureEventToErrorCode = (
  eventType: SourceIngestionFailureEventType,
): SourceIngestionErrorCode => sourceIngestionFailureCodeByEventType[eventType];

const resolveSourceIngestionErrorCode = (
  error: unknown,
): SourceIngestionErrorCode => {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("timed out")) {
    return SourceIngestionErrorCode.TIMEOUT;
  }

  if (normalizedMessage.includes("404")) {
    return SourceIngestionErrorCode.NOT_FOUND;
  }

  if (error instanceof Error) {
    return SourceIngestionErrorCode.TRANSIENT_FAILURE;
  }

  return SourceIngestionErrorCode.UNKNOWN_ERROR;
};

const parseSourceIngestionErrorCode = (
  code: string,
): SourceIngestionErrorCode | null => {
  if (!sourceIngestionErrorCodeSet.has(code as SourceIngestionErrorCode)) {
    return null;
  }

  return code as SourceIngestionErrorCode;
};

export {
  SourceIngestionErrorCode,
  mapSourceIngestionFailureEventToErrorCode,
  parseSourceIngestionErrorCode,
  resolveSourceIngestionErrorCode,
};
export type { SourceIngestionFailureEventType };

