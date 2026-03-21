import { describe, expect, it } from "bun:test";
import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import {
  DispatchConflictCode,
} from "./dispatch-conflict-policy";
import { ProviderResolutionStatus } from "./provider-resolution-policy";
import {
  createProviderResolutionFailedStep,
  createStartupDispatchSteps,
  isUnresolvedProviderStatus,
  unresolvedProviderStatuses,
} from "./sync-user-dispatch-table";

describe("sync-user dispatch table", () => {
  it("creates deterministic startup dispatch steps", () => {
    const steps = createStartupDispatchSteps("calendar-1");
    expect(steps).toEqual([
      {
        conflictCode: DispatchConflictCode.LOCK_ACQUIRED,
        event: {
          holderId: "calendar-1",
          type: DestinationExecutionEventType.LOCK_ACQUIRED,
        },
      },
      {
        conflictCode: DispatchConflictCode.EXECUTION_STARTED,
        event: {
          type: DestinationExecutionEventType.EXECUTION_STARTED,
        },
      },
    ]);
  });

  it("maps unresolved provider statuses to fatal failure steps", () => {
    for (const status of unresolvedProviderStatuses) {
      const step = createProviderResolutionFailedStep(status);
      expect(step).toEqual({
        conflictCode: DispatchConflictCode.PROVIDER_RESOLUTION_FAILED,
        event: {
          code: status.toLowerCase(),
          reason: status.toLowerCase(),
          type: DestinationExecutionEventType.EXECUTION_FATAL_FAILED,
        },
      });
      expect(isUnresolvedProviderStatus(status)).toBe(true);
    }
  });

  it("excludes resolved provider status from unresolved status guard", () => {
    expect(isUnresolvedProviderStatus(ProviderResolutionStatus.RESOLVED)).toBe(false);
  });
});
