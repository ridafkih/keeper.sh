import { describe, expect, test } from "vitest";
import { retryDelayMs } from "../../src/client/backoff";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";

describe("a server that never recovers is not an infinite loop", () => {
  test("DAV-L15: a server failing forever stops at maxAttempts and reports the last failure", async () => {
    const harness = createHarness({ fake: { alwaysBusy: true } });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 2000,
      }),
    );

    expect(failureKindOf(listed)).toBe("rateLimited");
    expect(harness.fake.requestsOf("PROPFIND").length).toBe(3);
  }, 30_000);

  test("DAV-L15: the ceiling is the configured one, not an incidental constant", async () => {
    const attempts: number[] = [];
    for (const maxAttempts of [2, 5]) {
      const harness = createHarness({ fake: { alwaysBusy: true } });
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, {
          maxAttempts,
          retryDelayCeilingMs: 1,
          deadlineMs: 2000,
        }),
      );
      attempts.push(harness.fake.requestsOf("PROPFIND").length);
    }

    expect(attempts).toEqual([2, 5]);
  }, 30_000);

  test("DAV-L16: a Retry-After of one hour is clamped to the ceiling", () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, {
      maxAttempts: 2,
      retryDelayCeilingMs: 250,
    });
    const anHourAway = new Date(Date.parse(harness.environment.clock.now().value) + 3_600_000);

    const delay = retryDelayMs(
      { kind: "throttled", retryAfter: { kind: "instant", value: anHourAway.toISOString() } },
      { clock: harness.environment.clock, context, randomFraction: () => 1 },
      1,
    );

    expect(delay).toBe(250);
  }, 30_000);
});
