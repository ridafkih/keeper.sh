import { describe, expect, it } from "vitest";
import { appendOperationErrorTallies } from "../../../src/core/sync-engine/operation-error-tallies";
import type { TalliedOperationError } from "../../../src/core/sync-engine/operation-error-tallies";

describe("tallying every failed write on the wide event", () => {
  it("counts each failure by operation, status, error type and reason beyond the sample", () => {
    const conflict: TalliedOperationError = {
      errorType: "CalDAVConflictRecoveryError",
      reason: "conflict_object_missing",
      statusCode: 412,
      type: "add",
    };
    const throttled: TalliedOperationError = { errorType: "CalDAVHttpError", statusCode: 503, type: "add" };
    const wideEvent: Record<string, unknown> = {};

    appendOperationErrorTallies(wideEvent, [
      ...Array.from({ length: 149 }, () => conflict),
      throttled,
      { type: "remove" },
    ]);

    expect(wideEvent).toEqual({
      "operation_errors.add.error_type.CalDAVConflictRecoveryError": 149,
      "operation_errors.add.error_type.CalDAVHttpError": 1,
      "operation_errors.add.reason.conflict_object_missing": 149,
      "operation_errors.add.reason.unspecified": 1,
      "operation_errors.add.status.412": 149,
      "operation_errors.add.status.503": 1,
      "operation_errors.remove.error_type.unknown": 1,
      "operation_errors.remove.reason.unspecified": 1,
      "operation_errors.remove.status.none": 1,
    });
  });
});
