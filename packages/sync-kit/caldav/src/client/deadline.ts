import type { NotAttemptedReason, OperationContext } from "@keeper.sh/sync-protocol";
import type { CalDAVClock } from "../dependencies";

interface MergedSignal {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly release: () => void;
}

type Raced<Value> =
  | { readonly kind: "settled"; readonly value: Value }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

const mergeSignals = (signals: readonly AbortSignal[]): MergedSignal => {
  const merged = new AbortController();
  const listening = new AbortController();
  const release = (): void => {
    listening.abort();
  };
  const abort = (): void => {
    merged.abort();
    listening.abort();
  };
  const alreadyAborted = signals.some((candidate) => candidate.aborted);
  if (alreadyAborted) {
    merged.abort();
    return { signal: merged.signal, abort, release };
  }
  for (const candidate of signals) {
    candidate.addEventListener(
      "abort",
      () => {
        merged.abort();
      },
      { signal: listening.signal },
    );
  }
  return { signal: merged.signal, abort, release };
};

const remainingMilliseconds = (context: OperationContext, clock: CalDAVClock): number =>
  Date.parse(context.deadline.value) - Date.parse(clock.now().value);

const notAttempted = <Value>(reason: NotAttemptedReason): Raced<Value> => ({
  kind: "notAttempted",
  reason,
});

const noSettlement = (): null => null;

const aborting = <Value>(signal: AbortSignal, controller: AbortController): Promise<Raced<Value>> =>
  new Promise<Raced<Value>>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve(notAttempted("aborted"));
      },
      { signal: controller.signal },
    );
  });

const raceDeadline = async <Value>(
  context: OperationContext,
  clock: CalDAVClock,
  execute: (signal: AbortSignal) => Promise<Value>,
): Promise<Raced<Value>> => {
  if (context.signal.aborted) {
    return notAttempted("aborted");
  }
  const budget = remainingMilliseconds(context, clock);
  if (budget <= 0) {
    return notAttempted("budgetExhausted");
  }
  const merged = mergeSignals([context.signal]);
  const watching = new AbortController();
  const expiry = new AbortController();
  const never = (): Promise<Raced<Value>> => new Promise<Raced<Value>>(noSettlement);
  const expired = clock
    .sleep(budget, expiry.signal)
    .then((): Raced<Value> => notAttempted("budgetExhausted"))
    .catch(() => never());
  const running = execute(merged.signal).then((value): Raced<Value> => ({
    kind: "settled",
    value,
  }));
  running.catch(noSettlement);
  try {
    const outcome = await Promise.race([
      running,
      expired,
      aborting<Value>(context.signal, watching),
    ]);
    if (outcome.kind === "notAttempted") {
      merged.abort();
    }
    return outcome;
  } finally {
    expiry.abort();
    watching.abort();
    merged.release();
  }
};

export { mergeSignals, raceDeadline, remainingMilliseconds };
export type { MergedSignal, Raced };
