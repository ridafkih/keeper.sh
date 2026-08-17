import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createSemaphore } from "../../src/client/semaphore";
import { createGoogleInternals } from "../../src/internals";
import { registerWatchChannel } from "../../src/push/watch";
import { failureKindOf } from "../support/expect";
import {
  createHarness,
  googleCalendar,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

const stalled = () => {
  const harness = createHarness();
  harness.environment.transport.stall();
  return harness;
};

describe("every verb, not only listChanges, is bounded by the operation deadline", () => {
  test("GOOG-L2: a write against a transport that never answers settles at the deadline", async () => {
    const harness = stalled();

    const answered = await harness.provider.write(
      createIntent("stalled-write", normalizedOf(timedContent()), "google-tests"),
      operationContext(harness.environment, { deadlineMs: 25 }),
    );

    expect(harness.environment.transport.callCount()).toBeGreaterThan(0);
    expect(answered.ok).toBe(true);
    if (!answered.ok) {
      throw new Error("a stalled write failed rather than reporting a spent budget");
    }
    expect(answered.value).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
  }, 30_000);

  test("GOOG-L2: listCalendars against a transport that never answers settles at the deadline", async () => {
    const harness = stalled();

    const answered = await harness.provider.listCalendars(
      googleCalendar.account,
      operationContext(harness.environment, { deadlineMs: 25 }),
    );

    expect(failureKindOf(answered)).toBe("notAttempted");
  }, 30_000);

  test("GOOG-L2: registering a watch channel against a stalled transport settles at the deadline", async () => {
    const harness = stalled();

    const answered = await registerWatchChannel(
      {
        calendar: googleCalendar,
        callbackUrl: "https://keeper.sh/push/google",
        token: "the-real-token",
      },
      operationContext(harness.environment, { deadlineMs: 25 }),
      {
        dependencies: harness.dependencies,
        requests: createRequestSeam({
          dependencies: harness.dependencies,
          permits: createSemaphore(harness.dependencies.concurrency),
        }),
      },
    );

    expect(failureKindOf(answered)).toBe("notAttempted");
  }, 30_000);

  test("GOOG-L2: a permit abandoned at its deadline returns to the pool", async () => {
    const harness = stalled();
    const internals = createGoogleInternals(harness.dependencies);
    const available = internals.permits.available();

    for (const _attempt of [1, 2, 3, 4, 5]) {
      await internals.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5 }),
      );
    }

    expect(internals.permits.available()).toBe(available);
    expect(internals.permits.waiting()).toBe(0);
  }, 30_000);

  test("GOOG-L2: a starved pool still answers once the transport recovers", async () => {
    const harness = stalled();
    const internals = createGoogleInternals(harness.dependencies);
    for (const _attempt of [1, 2, 3, 4, 5]) {
      await internals.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5 }),
      );
    }
    harness.environment.transport.resume();

    const answered = await internals.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 500 }),
    );

    expect(answered.ok).toBe(true);
  }, 30_000);
});
