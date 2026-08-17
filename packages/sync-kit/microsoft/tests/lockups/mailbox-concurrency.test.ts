import { describe, expect, test } from "vitest";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("one mailbox admits four requests and no more, and does not block another mailbox", () => {
  test("MS-L1: in-flight requests to one mailbox never exceed four, and a second mailbox is not blocked", async () => {
    const permits = createMailboxSemaphore(microsoftLimits.mailboxConcurrency);
    const release = Promise.withResolvers<null>();
    const started: string[] = [];

    const twelveToOneMailbox = [...Array.from({ length: 12 }).keys()].map((index) =>
      permits.withPermits(["mailbox-one"], neverAborts(), async () => {
        started.push(`one-${index}`);
        await release.promise;
        return index;
      }),
    );
    const oneToAnotherMailbox = permits.withPermits(["mailbox-two"], neverAborts(), () => {
      started.push("two-0");
      return Promise.resolve(0);
    });

    await oneToAnotherMailbox;
    const startedWhileSaturated = [...started];
    release.resolve(null);
    await Promise.all(twelveToOneMailbox);

    expect(permits.peak("mailbox-one")).toBe(microsoftLimits.mailboxConcurrency);
    expect(startedWhileSaturated).toContain("two-0");
    expect(startedWhileSaturated.filter((name) => name.startsWith("one-"))).toHaveLength(
      microsoftLimits.mailboxConcurrency,
    );
  }, 30_000);

  test("MS-L1: the ceiling is the configured one, not an incidental one", async () => {
    const two = createMailboxSemaphore(2);
    const release = Promise.withResolvers<null>();
    const inFlight = [1, 2, 3, 4].map(() =>
      two.withPermits(["mailbox-one"], neverAborts(), () => release.promise),
    );

    await Promise.resolve();
    const peakUnderTwo = two.peak("mailbox-one");
    release.resolve(null);
    await Promise.all(inFlight);

    expect(peakUnderTwo).toBe(2);
  }, 30_000);
});
