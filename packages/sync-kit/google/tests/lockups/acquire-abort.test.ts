import { describe, expect, test } from "vitest";
import { createSemaphore } from "../../src/client/semaphore";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "fanned", start: "2026-03-26T09:00:00.000Z", end: "2026-03-26T10:00:00.000Z" }),
];

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("an aborted waiter never strands the callers beside it", () => {
  test("GOOG-L10: an abort while waiting for capacity releases the wait and arms no timer", async () => {
    const permits = createSemaphore(1);
    const holding = new AbortController();
    const released = Promise.withResolvers<null>();
    const held = permits.withPermit(holding.signal, () => released.promise);
    const waiter = new AbortController();

    const waiting = permits.withPermit(waiter.signal, () => Promise.resolve("never runs"));
    waiter.abort();
    released.resolve(null);
    await held;

    await expect(waiting).rejects.toThrow();
    expect(permits.waiting()).toBe(0);
    expect(permits.available()).toBe(1);
  }, 30_000);

  test("GOOG-L10: one aborted caller in a fan-out costs only that caller", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);
    const healthy = [1, 2, 3, 4].map(() =>
      harness.provider.listChanges({ scope, resume: null }, operationContext(harness.environment)),
    );
    const cancelled = harness.provider.listChanges(
      { scope, resume: null },
      operationContext(harness.environment, { signal: abortedSignal() }),
    );

    const answers = await Promise.all([...healthy, cancelled]);

    expect(answers.slice(0, 4).map((answer) => answer.ok)).toEqual([true, true, true, true]);
    expect(answers.at(4)?.ok).toBe(false);
  }, 30_000);

  test("GOOG-L10: a listing issued after the aborted one still succeeds", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);
    await harness.provider.listChanges(
      { scope, resume: null },
      operationContext(harness.environment, { signal: abortedSignal() }),
    );

    const afterwards = await harness.provider.listChanges(
      { scope, resume: null },
      operationContext(harness.environment),
    );

    expect(afterwards.ok).toBe(true);
  });

  test("GOOG-L10: the fan-out never runs more work at once than the concurrency it was handed", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);

    await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) =>
        harness.provider.listChanges(
          { scope: { ...scope, expandRecurrences: index % 2 === 0 }, resume: null },
          operationContext(harness.environment),
        ),
      ),
    );

    expect(harness.environment.transport.inFlightPeak()).toBeLessThanOrEqual(
      harness.dependencies.concurrency,
    );
  }, 30_000);
});
