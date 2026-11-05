import type { EventTime } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { IcsOptions } from "../options";
import { resolveEventTime } from "./event-time";
import { emptyDocument } from "./parse-calendar";
import type { VeventComponent } from "./parse-calendar";

type EndTimeResolution =
  | { readonly kind: "resolved"; readonly time: EventTime }
  | { readonly kind: "unbuildable" };

const resolveEndTime = (component: VeventComponent, options: IcsOptions): EndTimeResolution => {
  const resolution = resolveEventTime(component, emptyDocument, options);
  switch (resolution.kind) {
    case "resolved": {
      return { kind: "resolved", time: resolution.time };
    }
    case "withheld": {
      return { kind: "unbuildable" };
    }
    default: {
      return assertNever(resolution);
    }
  }
};

export { resolveEndTime };
export type { EndTimeResolution };
