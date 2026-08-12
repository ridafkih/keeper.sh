import { describe, expect, it } from "vitest";
import { raceAbortSignal, withAbortTimeout } from "../../src/utils/with-abort-timeout";

const neverSettles = (): Promise<never> => Promise.withResolvers<never>().promise;

const waitForAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

describe("withAbortTimeout", () => {
  it("returns an operation that completes before the deadline", async () => {
    await expect(withAbortTimeout(() => Promise.resolve("complete"), 100))
      .resolves.toBe("complete");
  });

  it("aborts cooperative work with a classified timeout error", async () => {
    await expect(withAbortTimeout(waitForAbort, 1)).rejects.toMatchObject({
      message: "Source ingestion timed out after 1ms",
      name: "TimeoutError",
    });
  });

  it("waits for non-cooperative work to stop before reporting the timeout", async () => {
    const operation = Promise.withResolvers<boolean>();
    let settled = false;
    const result = withAbortTimeout(() => operation.promise, 1).finally(() => {
      settled = true;
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(settled).toBe(false);

    operation.resolve(true);
    await expect(result).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("raceAbortSignal", () => {
  it("resolves with the operation result when it settles first", async () => {
    const controller = new AbortController();

    await expect(raceAbortSignal(controller.signal, Promise.resolve("done")))
      .resolves.toBe("done");
  });

  it("rejects with the abort reason when a signal already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("already gone");
    controller.abort(reason);

    await expect(raceAbortSignal(controller.signal, neverSettles()))
      .rejects.toBe(reason);
  });

  it("settles a never-settling operation as soon as the deadline fires", async () => {
    let settled = false;

    const result = withAbortTimeout(
      (signal) => raceAbortSignal(signal, neverSettles()),
      1,
    ).finally(() => {
      settled = true;
    });

    await expect(result).rejects.toMatchObject({
      message: "Source ingestion timed out after 1ms",
      name: "TimeoutError",
    });
    expect(settled).toBe(true);
  });
});
