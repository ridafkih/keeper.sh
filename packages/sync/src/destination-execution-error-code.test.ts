import { describe, expect, it } from "bun:test";
import {
  DestinationExecutionFailureClassification,
  DestinationExecutionErrorCode,
  mapDestinationFailureClassificationToErrorCode,
} from "./destination-execution-error-code";

describe("destination-execution-error-code", () => {
  it("maps retryable classification to canonical retryable code", () => {
    expect(
      mapDestinationFailureClassificationToErrorCode(
        DestinationExecutionFailureClassification.RETRYABLE,
      ),
    ).toBe(DestinationExecutionErrorCode.RETRYABLE_FAILURE);
  });

  it("maps terminal classification to canonical terminal code", () => {
    expect(
      mapDestinationFailureClassificationToErrorCode(
        DestinationExecutionFailureClassification.TERMINAL,
      ),
    ).toBe(DestinationExecutionErrorCode.TERMINAL_FAILURE);
  });
});
