import type { ListingMode } from "../cursor/fingerprint";
import type { DecodedItem } from "../decode/decode-event";

const resyncTriggers = ["gone", "seriesMasterOnDelta", "untypedRemoval"] as const;
type ResyncTrigger = (typeof resyncTriggers)[number];

type ResyncVerdict =
  | { readonly kind: "carryOn" }
  | { readonly kind: "resyncRequired"; readonly trigger: ResyncTrigger };

const namesASeriesMaster = (item: DecodedItem): boolean =>
  item.kind === "decoded" && item.type === "seriesMaster";

const namesAnUntypedRemoval = (item: DecodedItem): boolean =>
  item.kind === "tombstone" && item.removal.kind === "untyped";

const resyncVerdictOf = (items: readonly DecodedItem[], mode: ListingMode): ResyncVerdict => {
  if (mode !== "delta") {
    return { kind: "carryOn" };
  }
  if (items.some((item) => namesASeriesMaster(item))) {
    return { kind: "resyncRequired", trigger: "seriesMasterOnDelta" };
  }
  if (items.some((item) => namesAnUntypedRemoval(item))) {
    return { kind: "resyncRequired", trigger: "untypedRemoval" };
  }
  return { kind: "carryOn" };
};

export { resyncTriggers, resyncVerdictOf };
export type { ResyncTrigger, ResyncVerdict };
