import { describe, expect, test } from "vitest";
import { createMailboxSemaphore } from "../../src/client/semaphore";

const neverAborts = (): AbortSignal => new AbortController().signal;

const nameOfError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown";
};

const settlementOf = (pending: Promise<unknown>): Promise<string> =>
  pending.then(() => "resolved").catch(nameOfError);

describe("a caller aborted as its permit is handed over never reaches Graph", () => {
  test("MS-L26: an abort between release and body rejects instead of running the body", async () => {
    const permits = createMailboxSemaphore(1);
    const holderRelease = Promise.withResolvers<null>();
    const holder = permits.withPermits(["mailbox-one"], neverAborts(), () => holderRelease.promise);
    const latecomer = new AbortController();
    let bodyRan = false;

    const queued = permits.withPermits(["mailbox-one"], latecomer.signal, () => {
      bodyRan = true;
      return Promise.resolve("the aborted caller wrote to Graph");
    });
    await Promise.resolve();
    holderRelease.resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    latecomer.abort();
    await holder;

    expect(await settlementOf(queued)).toBe("PermitAborted");
    expect(bodyRan).toBe(false);
    expect(permits.held("mailbox-one")).toBe(0);
    expect(permits.waiting("mailbox-one")).toBe(0);
  }, 30_000);

  test("MS-L27: the permit freed by the aborted handover is still usable by the next caller", async () => {
    const permits = createMailboxSemaphore(1);
    const holderRelease = Promise.withResolvers<null>();
    const holder = permits.withPermits(["mailbox-one"], neverAborts(), () => holderRelease.promise);
    const latecomer = new AbortController();

    const abandoned = permits.withPermits(["mailbox-one"], latecomer.signal, () =>
      Promise.resolve("never"),
    );
    const successor = permits.withPermits(["mailbox-one"], neverAborts(), () =>
      Promise.resolve("the successor ran"),
    );
    await Promise.resolve();
    holderRelease.resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    latecomer.abort();
    await holder;

    expect(await settlementOf(abandoned)).toBe("PermitAborted");
    await expect(successor).resolves.toBe("the successor ran");
    expect(permits.held("mailbox-one")).toBe(0);
  }, 30_000);
});
