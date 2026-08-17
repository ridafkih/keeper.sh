import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { countingSemaphore } from "../support/counting-semaphore";
import { createHarness, operationContext } from "../support/harness";

const failsTwice = {
  kind: "status",
  status: 429,
  retryAfter: null,
  times: 2,
} as const;

describe("quota is metered per attempt, not per operation", () => {
  test("GOOG-L1: three attempts take three permits", async () => {
    const harness = createHarness();
    const permits = countingSemaphore(harness.dependencies.concurrency);
    const seam = createRequestSeam({ dependencies: harness.dependencies, permits: permits.semaphore });
    harness.environment.transport.answerWith(failsTwice);

    const outcome = await seam.send(
      "listChanges",
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
      () => Promise.resolve("answered"),
    );

    expect(outcome.kind).toBe("answered");
    expect(permits.acquisitions()).toBe(3);
  });

  test("GOOG-L1: every permit taken is a permit released", async () => {
    const harness = createHarness();
    const permits = countingSemaphore(harness.dependencies.concurrency);
    const seam = createRequestSeam({ dependencies: harness.dependencies, permits: permits.semaphore });
    harness.environment.transport.answerWith(failsTwice);

    await seam.send(
      "listChanges",
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
      () => Promise.resolve("answered"),
    );

    expect(permits.releases()).toBe(permits.acquisitions());
    expect(permits.held()).toBe(0);
  });

  test("GOOG-L1: a permit is taken inside the retry, so one attempt takes one permit", async () => {
    const harness = createHarness();
    const permits = countingSemaphore(harness.dependencies.concurrency);
    const seam = createRequestSeam({ dependencies: harness.dependencies, permits: permits.semaphore });

    await seam.send("listChanges", operationContext(harness.environment, { maxAttempts: 3 }), () =>
      Promise.resolve("answered"),
    );

    expect(permits.acquisitions()).toBe(1);
  });
});
