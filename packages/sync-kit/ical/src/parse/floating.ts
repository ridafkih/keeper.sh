import type { Instant } from "@keeper.sh/sync-protocol";
import type { IcsOptions } from "../options";
import { resolveDateValue } from "./date-value";
import { eventZoneOf } from "./event-time";
import type { IcsDocument, VeventComponent } from "./parse-calendar";

const floatingAnchorSources = ["eventTzid", "calendarTimezone"] as const;
type FloatingAnchorSource = (typeof floatingAnchorSources)[number];

type FloatingAnchor =
  | { readonly kind: "anchored"; readonly instant: Instant; readonly via: FloatingAnchorSource }
  | { readonly kind: "unsupported" };

const anchorSourceFor = (component: VeventComponent): FloatingAnchorSource => {
  if (eventZoneOf(component)) {
    return "eventTzid";
  }
  return "calendarTimezone";
};

const anchorFloatingValue = (
  value: string,
  component: VeventComponent,
  document: IcsDocument,
  options: IcsOptions,
): FloatingAnchor => {
  const resolved = resolveDateValue(
    { name: "DTSTART", params: "", value },
    value,
    eventZoneOf(component),
    document,
    options.zones,
  );
  if (resolved.kind !== "instant") {
    return { kind: "unsupported" };
  }
  return { kind: "anchored", instant: resolved.instant, via: anchorSourceFor(component) };
};

export { anchorFloatingValue, floatingAnchorSources };
export type { FloatingAnchor, FloatingAnchorSource };
