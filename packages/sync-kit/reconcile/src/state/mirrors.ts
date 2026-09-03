import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import type { ObservedState } from "./observed";

interface MirrorIndex {
  readonly listed: boolean;
  readonly byId: ReadonlyMap<string, RemoteEvent>;
}

const indexMirrors = (observed: ObservedState): MirrorIndex => {
  if (observed.kind === "sourceOnly") {
    return { listed: false, byId: new Map() };
  }
  const events = observed.destination.events ?? [];
  return { listed: true, byId: new Map(events.map((event) => [event.id.value, event])) };
};

export { indexMirrors };
export type { MirrorIndex };
