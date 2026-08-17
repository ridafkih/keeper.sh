import type { ListingScope } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";

const listingModes = ["snapshot", "delta"] as const;
type ListingMode = (typeof listingModes)[number];

const adapterShapeVersion = 1;

const requestShapeFingerprint = (
  scope: ListingScope,
  mode: ListingMode,
  hash: (input: string) => string,
): string =>
  hash(
    canonicalise({
      adapter: adapterShapeVersion,
      mode,
      provider: scope.calendar.provider,
      account: scope.calendar.account.value,
      calendar: scope.calendar.calendar.value,
      from: scope.window.start.value,
      until: scope.window.end.value,
      expandRecurrences: scope.expandRecurrences,
    }),
  );

export { adapterShapeVersion, listingModes, requestShapeFingerprint };
export type { ListingMode };
