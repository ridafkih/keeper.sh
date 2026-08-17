import type { OperationContext } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CalDAVClock } from "../dependencies";
import type { CalDAVFailure } from "../errors/classify";
import type { AttemptBudget } from "./attempt-budget";

type Attempt<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "retryable"; readonly failure: CalDAVFailure }
  | { readonly kind: "fatal"; readonly failure: CalDAVFailure }
  | { readonly kind: "aborted" };

type BackoffOutcome<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "failed"; readonly failure: CalDAVFailure }
  | { readonly kind: "exhausted"; readonly attempts: number }
  | { readonly kind: "aborted" };

interface BackoffOptions<Value> {
  readonly clock: CalDAVClock;
  readonly context: OperationContext;
  readonly attempts: AttemptBudget;
  readonly signal: AbortSignal;
  readonly randomFraction: () => number;
  readonly attempt: (attemptNumber: number) => Promise<Attempt<Value>>;
}

const firstDelayMs = 50;

const exponentialDelayMs = (attemptNumber: number): number =>
  firstDelayMs * 2 ** Math.max(0, attemptNumber - 1);

const askedDelayMs = (
  failure: CalDAVFailure,
  options: Pick<BackoffOptions<unknown>, "clock" | "context">,
): number | null => {
  if (failure.kind !== "throttled" || failure.retryAfter === null) {
    return null;
  }
  return Date.parse(failure.retryAfter.value) - Date.parse(options.clock.now().value);
};

const retryDelayMs = (
  failure: CalDAVFailure,
  options: Pick<BackoffOptions<unknown>, "clock" | "context" | "randomFraction">,
  attemptNumber: number,
): number => {
  const ceiling = options.context.retryBudget.retryDelayCeilingMs;
  const asked = askedDelayMs(failure, options);
  if (asked !== null) {
    return Math.max(0, Math.min(ceiling, asked));
  }
  const jittered = exponentialDelayMs(attemptNumber) * options.randomFraction();
  return Math.max(0, Math.min(ceiling, Math.round(jittered)));
};

const slept = async <Value>(
  options: BackoffOptions<Value>,
  milliseconds: number,
): Promise<boolean> => {
  const outcome = await options.clock.sleep(milliseconds, options.signal).then(
    () => true,
    () => false,
  );
  return outcome;
};

const withBackoff = async <Value>(
  options: BackoffOptions<Value>,
): Promise<BackoffOutcome<Value>> => {
  const walk = { attemptNumber: 0 };
  while (options.attempts.claim()) {
    walk.attemptNumber += 1;
    if (options.signal.aborted) {
      return { kind: "aborted" };
    }
    const attempted = await options.attempt(walk.attemptNumber);
    switch (attempted.kind) {
      case "answered": {
        return { kind: "answered", value: attempted.value };
      }
      case "fatal": {
        return { kind: "failed", failure: attempted.failure };
      }
      case "aborted": {
        return { kind: "aborted" };
      }
      case "retryable": {
        if (options.attempts.remaining() === 0) {
          return { kind: "failed", failure: attempted.failure };
        }
        const rested = await slept(options, retryDelayMs(attempted.failure, options, walk.attemptNumber));
        if (!rested) {
          return { kind: "aborted" };
        }
        break;
      }
      default: {
        return assertNever(attempted);
      }
    }
  }
  return { kind: "exhausted", attempts: walk.attemptNumber };
};

export { retryDelayMs, withBackoff };
export type { Attempt, BackoffOptions, BackoffOutcome };
