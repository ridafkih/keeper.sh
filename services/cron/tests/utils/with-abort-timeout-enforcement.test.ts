import { describe, expect, it } from "vitest";
import { withAbortTimeout } from "../../src/utils/with-abort-timeout";

/*
 * The scheduler worker holds its slot by awaiting task() to settlement, so
 * withAbortTimeout must settle an operation that takes no AbortSignal —
 * otherwise one half-open connection strands a slot for the whole pass.
 */
const nonCooperativeHang = (): Promise<never> =>
  Promise.withResolvers<never>().promise;

describe("withAbortTimeout deadline enforcement", () => {
  it("settles a non-signal-aware hung operation once the deadline fires", async () => {
    const timeoutMs = 50;
    const graceMs = 450;
    let outcome = "still pending after deadline plus grace";

    const wrapped = withAbortTimeout(nonCooperativeHang, timeoutMs)
      .then(
        () => {
          outcome = "resolved";
          return outcome;
        },
        () => {
          outcome = "rejected at deadline";
          return outcome;
        },
      );

    const grace = new Promise((resolve) => {
      setTimeout(resolve, timeoutMs + graceMs);
    });
    await Promise.race([wrapped, grace]);

    expect(outcome).toBe("rejected at deadline");
  });
});
