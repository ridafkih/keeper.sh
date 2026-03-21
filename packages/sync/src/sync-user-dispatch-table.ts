import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import type { DestinationExecutionEvent } from "@keeper.sh/state-machines";
import { DispatchConflictCode } from "./dispatch-conflict-policy";
import { ProviderResolutionStatus } from "./resolve-provider";

interface DestinationDispatchStep {
  conflictCode: DispatchConflictCode;
  event: DestinationExecutionEvent;
}

const createStartupDispatchSteps = (
  calendarId: string,
): readonly DestinationDispatchStep[] => [
  {
    conflictCode: DispatchConflictCode.LOCK_ACQUIRED,
    event: {
      holderId: calendarId,
      type: DestinationExecutionEventType.LOCK_ACQUIRED,
    },
  },
  {
    conflictCode: DispatchConflictCode.EXECUTION_STARTED,
    event: {
      type: DestinationExecutionEventType.EXECUTION_STARTED,
    },
  },
];

const unresolvedProviderStatuses: readonly Exclude<
  ProviderResolutionStatus,
  typeof ProviderResolutionStatus.RESOLVED
>[] = [
  ProviderResolutionStatus.MISCONFIGURED_PROVIDER,
  ProviderResolutionStatus.MISSING_PROVIDER_CREDENTIALS,
  ProviderResolutionStatus.UNSUPPORTED_PROVIDER,
] as const;

const isUnresolvedProviderStatus = (
  status: ProviderResolutionStatus,
): status is Exclude<ProviderResolutionStatus, typeof ProviderResolutionStatus.RESOLVED> =>
  unresolvedProviderStatuses.includes(
    status as Exclude<ProviderResolutionStatus, typeof ProviderResolutionStatus.RESOLVED>,
  );

const toProviderFailureCode = (
  status: Exclude<ProviderResolutionStatus, typeof ProviderResolutionStatus.RESOLVED>,
): string => status.toLowerCase();

const createProviderResolutionFailedStep = (
  status: Exclude<ProviderResolutionStatus, typeof ProviderResolutionStatus.RESOLVED>,
): DestinationDispatchStep => {
  const code = toProviderFailureCode(status);
  return {
    conflictCode: DispatchConflictCode.PROVIDER_RESOLUTION_FAILED,
    event: {
      code,
      reason: code,
      type: DestinationExecutionEventType.EXECUTION_FATAL_FAILED,
    },
  };
};

export {
  createProviderResolutionFailedStep,
  createStartupDispatchSteps,
  isUnresolvedProviderStatus,
  unresolvedProviderStatuses,
};
export type { DestinationDispatchStep };
