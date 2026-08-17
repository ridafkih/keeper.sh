import type { Instant, OperationName, ProviderFailure } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { DavPrecondition } from "../errors/precondition";
import { classifyCalDAVFailure } from "../errors/classify";
import type { CalDAVFailure } from "../errors/classify";
import { decodeDavError } from "../errors/dav-error";
import { toProviderFailure } from "../errors/to-provider-failure";
import type { CalDAVInternals } from "../internals";
import { createAttemptBudget } from "./attempt-budget";
import type { Attempt } from "./backoff";
import { withBackoff } from "./backoff";
import type { DavCall } from "./dav-client";
import { raceDeadline } from "./deadline";
import type { CalDAVOperation } from "./operation";

interface AnswerStatus {
  readonly status: number;
  readonly precondition: DavPrecondition | null;
  readonly retryAfter: Instant | null;
}

interface CalDAVRequest<Value> {
  readonly operation: OperationName;
  readonly collections: readonly string[];
  readonly run: CalDAVOperation;
  readonly accepts: readonly number[];
  readonly call: (call: DavCall) => Promise<Value>;
  readonly statusOf: (value: Value) => AnswerStatus;
}

type RequestOutcome<Value> =
  | { readonly kind: "answered"; readonly value: Value }
  | {
      readonly kind: "failed";
      readonly failure: ProviderFailure;
      readonly cause: CalDAVFailure | null;
    };

const successFloor = 200;
const redirectFloor = 300;
const successCeiling = 300;

const successful = (status: number): boolean =>
  status >= successFloor && status < successCeiling;

const redirected = (status: number): boolean => status >= redirectFloor && status < 400;

type Caught<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: unknown };

const wholeDelay = (): number => 1;

const retryable = (failure: CalDAVFailure): boolean =>
  failure.kind === "transient" || failure.kind === "throttled";

const attemptOf = <Value>(failure: CalDAVFailure): Attempt<Value> => {
  if (retryable(failure)) {
    return { kind: "retryable", failure };
  }
  return { kind: "fatal", failure };
};

const gateThrottle = (error: unknown): CalDAVFailure | null => {
  if (typeof error !== "object" || error === null || !("failure" in error)) {
    return null;
  }
  const { failure } = error;
  if (typeof failure !== "object" || failure === null || !("kind" in failure)) {
    return null;
  }
  if (failure.kind !== "rateLimited") {
    return null;
  }
  return { kind: "throttled", retryAfter: decodeDavError(failure).retryAfter };
};

const thrownAttempt = <Value>(
  error: unknown,
  operation: OperationName,
  signal: AbortSignal,
): Attempt<Value> => {
  if (signal.aborted) {
    return { kind: "aborted" };
  }
  const carried = gateThrottle(error);
  if (carried) {
    return attemptOf(carried);
  }
  const decoded = decodeDavError(error);
  return attemptOf(
    classifyCalDAVFailure({
      status: decoded.status,
      precondition: null,
      operation,
      retryAfter: decoded.retryAfter,
      credentialsWithheld: false,
    }),
  );
};

const runCalDAVRequest = async <Value>(
  internals: CalDAVInternals,
  request: CalDAVRequest<Value>,
): Promise<RequestOutcome<Value>> => {
  const { clock } = internals.dependencies;
  const { context, surroundings } = request.run;
  const attempts = createAttemptBudget(context.retryBudget.maxAttempts);
  const answering = async (signal: AbortSignal): Promise<Attempt<Value>> => {
    const attempted: Caught<Value> = await internals.dependencies
      .gate(request.operation, () =>
        request.call({
          client: internals.dependencies.client,
          transport: internals.transport,
          signal,
        }),
      )
      .then(
        (value): Caught<Value> => ({ ok: true, value }),
        (error: unknown): Caught<Value> => ({ ok: false, error }),
      );
    if (!attempted.ok) {
      return thrownAttempt(attempted.error, request.operation, signal);
    }
    const answered = request.statusOf(attempted.value);
    internals.authScope.record(answered.status);
    if (successful(answered.status) || request.accepts.includes(answered.status)) {
      return { kind: "answered", value: attempted.value };
    }
    if (redirected(answered.status)) {
      internals.authScope.recordWithheldCredentials();
    }
    return attemptOf(
      classifyCalDAVFailure({
        status: answered.status,
        precondition: answered.precondition,
        operation: request.operation,
        retryAfter: answered.retryAfter,
        credentialsWithheld: internals.authScope.credentialsWithheld(),
      }),
    );
  };

  const permitted = (): Promise<RequestOutcome<Value>> =>
    internals.permits.withPermits(request.collections, context.signal, async () => {
      const raced = await raceDeadline(context, clock, (signal) =>
        withBackoff<Value>({
          clock,
          context,
          attempts,
          signal,
          randomFraction: wholeDelay,
          attempt: () => answering(signal),
        }),
      );
      if (raced.kind === "notAttempted") {
        return {
          kind: "failed",
          failure: { kind: "notAttempted", reason: raced.reason },
          cause: null,
        };
      }
      const outcome = raced.value;
      switch (outcome.kind) {
        case "answered": {
          return { kind: "answered", value: outcome.value };
        }
        case "failed": {
          return {
            kind: "failed",
            failure: toProviderFailure(outcome.failure, surroundings),
            cause: outcome.failure,
          };
        }
        case "exhausted": {
          return {
            kind: "failed",
            failure: { kind: "notAttempted", reason: "budgetExhausted" },
            cause: null,
          };
        }
        case "aborted": {
          return {
            kind: "failed",
            failure: { kind: "notAttempted", reason: "aborted" },
            cause: null,
          };
        }
        default: {
          return assertNever(outcome);
        }
      }
    });

  const recordingSpend = (): void => {
    internals.decisions.recordAttempts(
      attempts.spent(),
      context.retryBudget.maxAttempts,
    );
  };

  const answered = await permitted()
    .finally(recordingSpend)
    .then(
      (outcome): RequestOutcome<Value> => outcome,
      (error: unknown): RequestOutcome<Value> => {
        const attempt = thrownAttempt<Value>(error, request.operation, context.signal);
        if (attempt.kind === "aborted") {
          return {
            kind: "failed",
            failure: { kind: "notAttempted", reason: "aborted" },
            cause: null,
          };
        }
        if (attempt.kind === "answered") {
          return { kind: "answered", value: attempt.value };
        }
        return {
          kind: "failed",
          failure: toProviderFailure(attempt.failure, surroundings),
          cause: attempt.failure,
        };
      },
    );
  return answered;
};

export { runCalDAVRequest };
export type { AnswerStatus, CalDAVRequest, RequestOutcome };
