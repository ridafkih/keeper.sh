import type { NotAttemptedReason, OperationContext } from "@keeper.sh/sync-protocol";
import type { GoogleClock } from "../dependencies";

interface MergedSignal {
  readonly signal: AbortSignal;
  readonly release: () => void;
}

type Raced<Value> =
  | { readonly kind: "settled"; readonly value: Value }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

const mergeSignals = (signals: readonly AbortSignal[]): MergedSignal => {
  const merged = new AbortController();
  const listening = new AbortController();
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted) {
    merged.abort();
    return { signal: merged.signal, release: () => listening.abort() };
  }
  for (const signal of signals) {
    signal.addEventListener("abort", () => merged.abort(), {
      once: true,
      signal: listening.signal,
    });
  }
  return { signal: merged.signal, release: () => listening.abort() };
};

const remainingMilliseconds = (context: OperationContext, clock: GoogleClock): number =>
  Date.parse(context.deadline.value) - Date.parse(clock.now().value);

const notAttempted = <Value>(reason: NotAttemptedReason): Raced<Value> => ({
  kind: "notAttempted",
  reason,
});

const raceDeadline = async <Value>(
  context: OperationContext,
  clock: GoogleClock,
  execute: (signal: AbortSignal) => Promise<Value>,
): Promise<Raced<Value>> => {
  if (context.signal.aborted) {
    return notAttempted("aborted");
  }
  const remaining = remainingMilliseconds(context, clock);
  if (remaining <= 0) {
    return notAttempted("budgetExhausted");
  }
  const settled = new AbortController();
  const stop = new AbortController();
  const merged = mergeSignals([context.signal, stop.signal]);
  const abandoned = Promise.withResolvers<Raced<Value>>();
  context.signal.addEventListener("abort", () => abandoned.resolve(notAttempted("aborted")), {
    once: true,
    signal: settled.signal,
  });
  const expiring = clock.sleep(remaining, settled.signal).then(
    () => notAttempted<Value>("budgetExhausted"),
    () => abandoned.promise,
  );
  try {
    return await Promise.race([
      execute(merged.signal).then((value) => ({ kind: "settled", value }) as const),
      abandoned.promise,
      expiring,
    ]);
  } finally {
    settled.abort();
    stop.abort();
    merged.release();
  }
};

export { mergeSignals, raceDeadline, remainingMilliseconds };
export type { MergedSignal, Raced };
