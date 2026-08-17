import type { NotAttemptedReason, OperationContext, OperationName } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { MicrosoftDependencies } from "../dependencies";
import type { MicrosoftFailure } from "../errors/classify";
import { classifyGraphError, isRetryable } from "../errors/classify";
import { decodeGraphError } from "../errors/graph-error";
import { microsoftLimits } from "../limits";
import type { Attempt } from "./backoff";
import { withBackoff } from "./backoff";
import type { MailboxSemaphore } from "./semaphore";
import { PermitAborted } from "./semaphore";

type RequestOutcome<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

interface RequestCall<Value> {
  readonly operation: OperationName;
  readonly mailboxes: readonly string[];
  readonly context: OperationContext;
  readonly send: (signal: AbortSignal) => Promise<Value>;
}

interface RequestSeam {
  readonly send: <Value>(call: RequestCall<Value>) => Promise<RequestOutcome<Value>>;
  readonly attemptsSpent: () => number;
  readonly attemptsAllowed: () => number;
}

interface RequestSeamOptions {
  readonly dependencies: MicrosoftDependencies;
  readonly permits: MailboxSemaphore;
}

const createRequestSeam = (options: RequestSeamOptions): RequestSeam => {
  const { dependencies, permits } = options;
  const budget = { spent: 0, allowed: 0 };

  const failureOf = (error: unknown, operation: OperationName): MicrosoftFailure =>
    classifyGraphError(decodeGraphError(error), operation, {
      clock: dependencies.clock,
      retryAfterCeilingMs: microsoftLimits.retryAfterCeilingMs,
    });

  const attemptOnce = async <Value>(
    call: RequestCall<Value>,
    signal: AbortSignal,
    attemptNumber: number,
  ): Promise<Attempt<Value>> => {
    budget.spent = Math.max(budget.spent, attemptNumber);
    try {
      const value = await permits.withPermits(call.mailboxes, signal, () =>
        dependencies.gate(call.operation, () => call.send(signal)),
      );
      return { kind: "answered", value };
    } catch (error) {
      if (error instanceof PermitAborted) {
        return { kind: "aborted" };
      }
      const failure = failureOf(error, call.operation);
      if (isRetryable(failure)) {
        return { kind: "retryable", failure };
      }
      return { kind: "fatal", failure };
    }
  };

  const send = async <Value>(call: RequestCall<Value>): Promise<RequestOutcome<Value>> => {
    const { context } = call;
    if (context.signal.aborted) {
      return { kind: "notAttempted", reason: "aborted" };
    }
    budget.allowed = Math.max(budget.allowed, context.retryBudget.maxAttempts);
    const outcome = await withBackoff<Value>({
      clock: dependencies.clock,
      context,
      signal: context.signal,
      randomFraction: dependencies.randomFraction,
      attempt: (attemptNumber) => attemptOnce(call, context.signal, attemptNumber),
    });
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
export type { RequestCall, RequestOutcome, RequestSeam, RequestSeamOptions };
