import { describe, expect, it } from "bun:test";
import { DestinationExecutionEventType } from "@keeper.sh/state-machines";
import {
  DestinationExecutionFailureClassification,
  mapDestinationExecutionFailureEvent,
} from "./destination-execution-failure-event";

describe("mapDestinationExecutionFailureEvent", () => {
  it("maps backoff-eligible errors to retryable machine failure event", () => {
    const mapped = mapDestinationExecutionFailureEvent(
      new Error("404 Not Found"),
      "2026-03-20T00:00:00.000Z",
    );

    expect(mapped.classification).toBe(
      DestinationExecutionFailureClassification.RETRYABLE,
    );
    expect(mapped.event).toEqual({
      at: "2026-03-20T00:00:00.000Z",
      code: "404 Not Found",
      reason: "404 Not Found",
      type: DestinationExecutionEventType.EXECUTION_FAILED,
    });
  });

  it("maps non-backoff errors to terminal machine failure event", () => {
    const mapped = mapDestinationExecutionFailureEvent(
      new Error("json parse exploded"),
      "2026-03-20T00:00:00.000Z",
    );

    expect(mapped.classification).toBe(
      DestinationExecutionFailureClassification.TERMINAL,
    );
    expect(mapped.event).toEqual({
      code: "json parse exploded",
      reason: "json parse exploded",
      type: DestinationExecutionEventType.EXECUTION_FATAL_FAILED,
    });
  });
});
