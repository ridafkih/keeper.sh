import type { OperationContext } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { GoogleClock } from "../dependencies";
import type { GoogleFailure } from "../errors/classify";

type Attempt<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "retryable"; readonly failure: GoogleFailure }
  | { readonly kind: "fatal"; readonly failure: GoogleFailure }
  | { readonly kind: "aborted" };

interface BackoffOptions<Value> {
  readonly clock: GoogleClock;
  readonly context: OperationContext;
  readonly signal: AbortSignal;
  readonly randomFraction: () => number;
  readonly attempt: (attemptNumber: number) => Promise<Attempt<Value>>;
}

type SleepOutcome = "slept" | "aborted" | "refused";

type BackoffOutcome<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "failed"; readonly failure: GoogleFailure }
  | { readonly kind: "exhausted"; readonly attempts: number }
  | { readonly kind: "aborted" };

const attemptsUpTo = (ceiling: number): readonly number[] =>
  Array.from({ length: Math.max(0, ceiling) }, (unused, index) => index + 1);

const backoffStepMs = 100;

const exponentialMs = (attemptNumber: number): number => backoffStepMs * 2 ** (attemptNumber - 1);

const askedDelayMs = (
  failure: GoogleFailure,
  clock: GoogleClock,
  attemptNumber: number,
): number => {
  if (failure.kind !== "rateLimited" || failure.retryAfter === null) {
    return exponentialMs(attemptNumber);
  }
  return Date.parse(failure.retryAfter.value) - Date.parse(clock.now().value);
};

const jitteredMs = (milliseconds: number, fraction: number): number => {
  const bounded = Math.min(1, Math.max(0, fraction));
  return Math.round(milliseconds * (0.5 + bounded / 2));
};

const retryDelayMs = (
  failure: GoogleFailure,
  options: Pick<BackoffOptions<unknown>, "clock" | "context" | "randomFraction">,
  attemptNumber: number,
): number => {
  const ceiling = options.context.retryBudget.retryDelayCeilingMs;
  const asked = askedDelayMs(failure, options.clock, attemptNumber);
  return Math.max(0, Math.min(ceiling, jitteredMs(asked, options.randomFraction())));
};

const sleptBetweenAttempts = async (
  milliseconds: number,
  options: BackoffOptions<unknown>,
): Promise<SleepOutcome> => {
  try {
    await options.clock.sleep(milliseconds, options.signal);
    return "slept";
  } catch {
    if (options.signal.aborted) {
      return "aborted";
    }
    return "refused";
  }
};

const withBackoff = async <Value>(
  options: BackoffOptions<Value>,
): Promise<BackoffOutcome<Value>> => {
  const ceiling = options.context.retryBudget.maxAttempts;
  for (const attemptNumber of attemptsUpTo(ceiling)) {
    if (options.signal.aborted) {
      return { kind: "aborted" };
    }
    const attempted = await options.attempt(attemptNumber);
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
        if (attemptNumber === ceiling) {
          return { kind: "failed", failure: attempted.failure };
        }
        const slept = await sleptBetweenAttempts(
          retryDelayMs(attempted.failure, options, attemptNumber),
          options,
        );
        if (slept === "aborted") {
          return { kind: "aborted" };
        }
        if (slept === "refused") {
          return { kind: "failed", failure: attempted.failure };
        }
        break;
      }
      default: {
        return assertNever(attempted);
      }
    }
  }
  return { kind: "exhausted", attempts: ceiling };
};

export { jitteredMs, retryDelayMs, withBackoff };
export type { Attempt, BackoffOptions, BackoffOutcome, SleepOutcome };
