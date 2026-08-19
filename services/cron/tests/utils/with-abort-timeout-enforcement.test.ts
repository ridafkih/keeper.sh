import { describe, expect, it } from "vitest";
import { withAbortTimeout } from "../../src/utils/with-abort-timeout";

/*
 * A pooled database read that takes no AbortSignal and hangs on a half-open
 * connection never settles on its own. The scheduler worker in
 * packages/calendar/src/core/utils/concurrency.ts holds its slot by awaiting
 * task() to settlement, so withAbortTimeout must force the wrapped operation
 * to settle at the deadline or the slot is stranded for the whole pass.
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
