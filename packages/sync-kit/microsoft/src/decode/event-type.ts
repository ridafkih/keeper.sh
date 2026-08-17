const graphEventTypes = ["singleInstance", "occurrence", "exception", "seriesMaster"] as const;
type GraphEventType = (typeof graphEventTypes)[number];

type EventTypeReading =
  | { readonly kind: "known"; readonly type: GraphEventType }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly presented: string };

const readEventType = (presented: unknown): EventTypeReading => {
  if ((presented ?? null) === null) {
    return { kind: "absent" };
  }
  if (typeof presented !== "string") {
    return { kind: "unknown", presented: String(presented) };
  }
  const known = graphEventTypes.find((candidate) => candidate === presented) ?? null;
  if (known === null) {
    return { kind: "unknown", presented };
  }
  return { kind: "known", type: known };
};

export { graphEventTypes, readEventType };
export type { EventTypeReading, GraphEventType };
