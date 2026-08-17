import { describe, expect, test } from "vitest";
import { retryAfterMilliseconds } from "../../src/errors/retry-after";
import { microsoftLimits } from "../../src/limits";
import { createHarness } from "../support/harness";

describe("a server-supplied delay can never become an unbounded await", () => {
  test("MS-L3: a Retry-After of 100000 seconds and a far-future HTTP-date both clamp to the ceiling", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      ceilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    expect(retryAfterMilliseconds("100000", options)).toBe(microsoftLimits.retryAfterCeilingMs);
    expect(retryAfterMilliseconds("Wed, 21 Oct 2099 07:28:00 GMT", options)).toBe(
      microsoftLimits.retryAfterCeilingMs,
    );
  });

  test("MS-L3: a delay under the ceiling is honoured, so the clamp is the ceiling and not a constant", () => {
    const harness = createHarness();
    const options = {
      clock: harness.environment.clock,
      ceilingMs: microsoftLimits.retryAfterCeilingMs,
    };

    expect(retryAfterMilliseconds("2", options)).toBe(2000);
    expect(retryAfterMilliseconds(null, options)).toBeNull();
  });
});
