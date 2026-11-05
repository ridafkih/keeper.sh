import type { OperationContext, ProviderFailure, Result } from "@keeper.sh/sync-protocol";

const abortedFailure: ProviderFailure = { kind: "notAttempted", reason: "aborted" };
const exhaustedFailure: ProviderFailure = { kind: "notAttempted", reason: "budgetExhausted" };

const remainingMilliseconds = (context: OperationContext): number =>
  Date.parse(context.deadline.value) - Date.parse(context.now().value);

const settledAs = <Value>(failure: ProviderFailure): Result<Value> => ({ ok: false, failure });

interface DeadlineAnswers {
  readonly onDeadline: ProviderFailure;
  readonly onAbort: ProviderFailure;
}

const raceDeadline = async <Value>(
  context: OperationContext,
  answers: DeadlineAnswers,
  work: () => Promise<Result<Value>>,
): Promise<Result<Value>> => {
  if (context.signal.aborted) {
    return settledAs(answers.onAbort);
  }
  if (remainingMilliseconds(context) <= 0) {
    return settledAs(answers.onDeadline);
  }
  const expired = Promise.withResolvers<Result<Value>>();
  const onCallerAbort = (): void => {
    expired.resolve(settledAs(answers.onAbort));
  };
  const timer = setTimeout(() => {
    expired.resolve(settledAs(answers.onDeadline));
  }, remainingMilliseconds(context));
  context.signal.addEventListener("abort", onCallerAbort, { once: true });
  try {
    return await Promise.race([expired.promise, work()]);
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onCallerAbort);
  }
};

const standardAnswers: DeadlineAnswers = {
  onDeadline: exhaustedFailure,
  onAbort: abortedFailure,
};

export { abortedFailure, exhaustedFailure, raceDeadline, remainingMilliseconds, standardAnswers };
export type { DeadlineAnswers };
