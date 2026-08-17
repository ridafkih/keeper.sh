import { describe, expect, test } from "vitest";
import { retryAfterMilliseconds } from "../../src/errors/retry-after";
import { microsoftLimits } from "../../src/limits";
import { createHarness, suiteStart } from "../support/harness";

const thirtySecondsAfterTheInjectedClock = new Date(
  Date.parse(suiteStart.value) + 30_000,
).toUTCString();

describe("delays are measured on the injected clock, never on the ambient one", () => {
  test("MS-L4: an HTTP-date Retry-After is measured on the injected clock, never on Date.now", () => {
    const harness = createHarness();

    const delay = retryAfterMilliseconds(thirtySecondsAfterTheInjectedClock, {
      clock: harness.environment.clock,
      ceilingMs: microsoftLimits.retryAfterCeilingMs,
    });

    expect(delay).toBe(30_000);
    expect(harness.environment.clock.nowCount()).toBeGreaterThan(0);
  });

  test("MS-L4: an HTTP-date already in the injected clock's past is not a negative sleep", () => {
    const harness = createHarness();
    const alreadyPassed = new Date(Date.parse(suiteStart.value) - 30_000).toUTCString();

    expect(
      retryAfterMilliseconds(alreadyPassed, {
        clock: harness.environment.clock,
        ceilingMs: microsoftLimits.retryAfterCeilingMs,
      }),
    ).toBe(0);
  });
});
