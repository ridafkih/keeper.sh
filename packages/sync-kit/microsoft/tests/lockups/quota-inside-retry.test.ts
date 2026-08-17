import type { Instant } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";
import { createHarness, operationContext } from "../support/harness";

describe("a retrying request does not hold a mailbox hostage", () => {
  test("MS-L18: a backoff sleep holds no mailbox permit", async () => {
    const harness = createHarness();
    const permits = createMailboxSemaphore(microsoftLimits.mailboxConcurrency);
    const heldDuringSleep: number[] = [];
    const observingClock = {
      now: (): Instant => harness.environment.clock.now(),
      sleep: (milliseconds: number, signal: AbortSignal): Promise<void> => {
        heldDuringSleep.push(permits.held("mailbox-one"));
        return harness.environment.clock.sleep(milliseconds, signal);
      },
    };
    const requests = createRequestSeam({
      dependencies: { ...harness.dependencies, clock: observingClock },
      permits,
    });
    let attempts = 0;

    await requests.send({
      operation: "listChanges",
      mailboxes: ["mailbox-one"],
      context: operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 5,
        deadlineMs: 5000,
      }),
      send: () => {
        attempts += 1;
        return Promise.reject(new Response(null, { status: 429 }));
      },
    });

    expect(attempts).toBe(3);
    expect(heldDuringSleep).toEqual([0, 0]);
    expect(permits.held("mailbox-one")).toBe(0);
  }, 30_000);
});
