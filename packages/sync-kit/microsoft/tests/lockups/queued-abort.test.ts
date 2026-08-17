import { describe, expect, test } from "vitest";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("a waiter that gives up does not strand the queue behind it", () => {
  test("MS-L14: a waiter aborted while queued rejects and frees its slot for its successor", async () => {
    const permits = createMailboxSemaphore(microsoftLimits.mailboxConcurrency);
    const release = Promise.withResolvers<null>();
    const holders = [1, 2, 3, 4].map(() =>
      permits.withPermits(["mailbox-one"], neverAborts(), () => release.promise),
    );
    const impatient = new AbortController();
    let successorRan = false;

    const queuedFirst = permits.withPermits(["mailbox-one"], impatient.signal, () =>
      Promise.resolve("the impatient waiter should never run"),
    );
    const queuedSecond = permits.withPermits(["mailbox-one"], neverAborts(), () => {
      successorRan = true;
      return Promise.resolve("the successor ran");
    });
    await Promise.resolve();
    impatient.abort();
    const refusal = await queuedFirst.then(
      () => "resolved",
      (error: unknown) => {
        if (error instanceof Error) {
          return error.name;
        }
        return "unknown";
      },
    );
    release.resolve(null);
    await Promise.all(holders);

    expect(refusal).toBe("PermitAborted");
    await expect(queuedSecond).resolves.toBe("the successor ran");
    expect(successorRan).toBe(true);
    expect(permits.waiting("mailbox-one")).toBe(0);
  }, 30_000);
});
