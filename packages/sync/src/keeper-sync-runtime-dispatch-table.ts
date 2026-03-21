import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import type { DestinationExecutionEvent } from "@keeper.sh/state-machines";
import { DispatchConflictCode } from "./dispatch-conflict-policy";
import {
  ProviderResolutionStatus,
  toUnresolvedProviderStatusCode,
  unresolvedProviderResolutionStatuses,
} from "./provider-resolution-policy";
import type { UnresolvedProviderResolutionStatus } from "./provider-resolution-policy";

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

const unresolvedProviderStatuses = unresolvedProviderResolutionStatuses;

const isUnresolvedProviderStatus = (
  status: ProviderResolutionStatus,
): status is UnresolvedProviderResolutionStatus =>
  unresolvedProviderStatuses.includes(
    status as UnresolvedProviderResolutionStatus,
  );

const createProviderResolutionFailedStep = (
  status: UnresolvedProviderResolutionStatus,
): DestinationDispatchStep => {
  const code = toUnresolvedProviderStatusCode(status);
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
