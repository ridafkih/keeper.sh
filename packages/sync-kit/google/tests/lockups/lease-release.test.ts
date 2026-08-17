import { describe, expect, test } from "vitest";
import { createSemaphore } from "../../src/client/semaphore";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "after", start: "2026-03-25T09:00:00.000Z", end: "2026-03-25T10:00:00.000Z" }),
];

describe("a permit is released when the body throws", () => {
  test("GOOG-L7: a throwing body releases its permit and the next call proceeds", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });
    const scope = scopeOver(marchWindow);

    const threw = await harness.provider.listChanges(
      { scope, resume: null },
      operationContext(harness.environment),
    );
    const afterwards = await harness.provider.listChanges(
      { scope, resume: null },
      operationContext(harness.environment),
    );

    expect(threw.ok).toBe(false);
    expect(afterwards.ok).toBe(true);
  });

  test("GOOG-L7: the semaphore itself hands the permit back after a throwing body", async () => {
    const permits = createSemaphore(1);
    const { signal } = new AbortController();

    await expect(
      permits.withPermit(signal, () => Promise.reject(new Error("the body threw"))),
    ).rejects.toThrow("the body threw");

    expect(permits.available()).toBe(1);
    await expect(permits.withPermit(signal, () => Promise.resolve("next"))).resolves.toBe("next");
  });

  test("GOOG-L7: a permit is not held once every caller has settled", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });

    await Promise.allSettled([
      harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    ]);

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  });
});
