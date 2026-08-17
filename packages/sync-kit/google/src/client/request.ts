import type {
  NotAttemptedReason,
  OperationContext,
  OperationName,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { GoogleDependencies } from "../dependencies";
import type { GoogleFailure } from "../errors/classify";
import { classifyGoogleError, isRetryable } from "../errors/classify";
import { decodeGaxiosError } from "../errors/gaxios-error";
import { gateFailureOf } from "../errors/gate-failure";
import type { Attempt } from "./backoff";
import { withBackoff } from "./backoff";
import { raceDeadline } from "./deadline";
import type { Semaphore } from "./semaphore";
import { PermitAborted } from "./semaphore";

type RequestOutcome<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "failed"; readonly failure: GoogleFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

interface RequestSeam {
  readonly send: <Value>(
    operation: OperationName,
    context: OperationContext,
    call: (signal: AbortSignal) => Promise<Value>,
  ) => Promise<RequestOutcome<Value>>;
  readonly attemptsSpent: () => number;
  readonly attemptsAllowed: () => number;
}

interface RequestSeamOptions {
  readonly dependencies: GoogleDependencies;
  readonly permits: Semaphore;
}

const failureOfError = (error: unknown, operation: OperationName): GoogleFailure =>
  gateFailureOf(error) ?? classifyGoogleError(decodeGaxiosError(error), operation);

const createRequestSeam = (options: RequestSeamOptions): RequestSeam => {
  const { dependencies, permits } = options;
  const budget = { spent: 0, allowed: 0 };

  const attemptOnce = async <Value>(
    operation: OperationName,
    context: OperationContext,
    call: (signal: AbortSignal) => Promise<Value>,
    attemptNumber: number,
  ): Promise<Attempt<Value>> => {
    budget.spent = Math.max(budget.spent, attemptNumber);
    try {
      const value = await permits.withPermit(context.signal, () =>
        dependencies.gate(operation, () => call(context.signal)),
      );
      return { kind: "answered", value };
    } catch (error) {
      if (error instanceof PermitAborted) {
        return { kind: "aborted" };
      }
      const failure = failureOfError(error, operation);
      if (isRetryable(failure)) {
        return { kind: "retryable", failure };
      }
      return { kind: "fatal", failure };
    }
  };

  const send = async <Value>(
    operation: OperationName,
    context: OperationContext,
    call: (signal: AbortSignal) => Promise<Value>,
  ): Promise<RequestOutcome<Value>> => {
    if (context.signal.aborted) {
      return { kind: "notAttempted", reason: "aborted" };
    }
    budget.allowed = Math.max(budget.allowed, context.retryBudget.maxAttempts);
    const raced = await raceDeadline(context, dependencies.clock, (signal) =>
      withBackoff<Value>({
        clock: dependencies.clock,
        context,
        signal,
        randomFraction: dependencies.randomFraction,
        attempt: (attemptNumber) =>
          attemptOnce(operation, { ...context, signal }, call, attemptNumber),
      }),
    );
    if (raced.kind === "notAttempted") {
      return { kind: "notAttempted", reason: raced.reason };
    }
    const outcome = raced.value;
    switch (outcome.kind) {
      case "answered": {
        return { kind: "answered", value: outcome.value };
      }
      case "failed": {
        return { kind: "failed", failure: outcome.failure };
      }
      case "exhausted": {
        return { kind: "notAttempted", reason: "budgetExhausted" };
      }
      case "aborted": {
        return { kind: "notAttempted", reason: "aborted" };
      }
      default: {
        return assertNever(outcome);
      }
    }
  };

  return {
    send,
    attemptsSpent: () => budget.spent,
    attemptsAllowed: () => budget.allowed,
  };
};

export { createRequestSeam };
export type { RequestOutcome, RequestSeam, RequestSeamOptions };
