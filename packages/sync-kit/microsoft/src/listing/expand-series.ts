import type { OperationContext, RemoteEventId } from "@keeper.sh/sync-protocol";
import type { MicrosoftFailure } from "../errors/classify";

type SeriesExpansion =
  | { readonly kind: "expanded"; readonly instances: readonly unknown[] }
  | { readonly kind: "empty" }
  | { readonly kind: "abandoned" }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure };

interface ExpandOptions {
  readonly master: RemoteEventId;
  readonly context: OperationContext;
  readonly fetchInstances: (master: RemoteEventId) => Promise<SeriesExpansion>;
}

const expandSeries = async (options: ExpandOptions): Promise<SeriesExpansion> => {
  if (options.context.signal.aborted) {
    return { kind: "abandoned" };
  }
  const answered = await options.fetchInstances(options.master);
  if (answered.kind === "expanded" && answered.instances.length === 0) {
    return { kind: "empty" };
  }
  return answered;
};

export { expandSeries };
export type { ExpandOptions, SeriesExpansion };
