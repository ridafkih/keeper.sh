import { describe, expect, test } from "vitest";
import { classifyGraphError } from "../../src/errors/classify";
import { decodeGraphError } from "../../src/errors/graph-error";
import { microsoftCapabilities } from "../../src/capabilities";
import { microsoftLimits } from "../../src/limits";
import { createHarness } from "../support/harness";

describe("MailboxConcurrency throttling arrives as a 503 as often as a 429", () => {
  test("MS-L2: a 503 with Retry-After classifies as throttled, exactly like a 429", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    const tooManyRequests = classifyGraphError(
      decodeGraphError({ statusCode: 429, code: "activityLimitReached", headers: { "retry-after": "3" } }),
      "listChanges",
      options,
    );
    const serviceUnavailable = classifyGraphError(
      decodeGraphError({ statusCode: 503, code: "UnknownError", headers: { "retry-after": "3" } }),
      "listChanges",
      options,
    );

    expect(serviceUnavailable.kind).toBe("throttled");
    expect(serviceUnavailable).toEqual(tooManyRequests);
  });

  test("MS-L2: both throttle statuses are declared to the conformance suite", () => {
    const harness = createHarness();

    const serviceUnavailable = classifyGraphError(
      decodeGraphError({ statusCode: 503, code: "UnknownError", headers: { "retry-after": "3" } }),
      "listChanges",
      { clock: harness.environment.clock, retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs },
    );

    expect(microsoftCapabilities.throttleSignals.map((signal) => signal.status)).toEqual([429, 503]);
    expect(serviceUnavailable.kind).toBe("throttled");
  });

  test("MS-L2: a throttled failure carries the retry instant the header named", () => {
    const harness = createHarness();

    const throttled = classifyGraphError(
      decodeGraphError({ statusCode: 503, code: "UnknownError", headers: { "retry-after": "3" } }),
      "listChanges",
      { clock: harness.environment.clock, retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs },
    );

    if (throttled.kind !== "throttled") {
      throw new Error(`a 503 with Retry-After classified as "${throttled.kind}"`);
    }
    expect(throttled.retryAfter?.value).toBe("2026-03-11T00:00:03.000Z");
  });
});
