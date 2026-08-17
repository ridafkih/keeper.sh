import type { ListingScope } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";
import { microsoftPrefer } from "../client/prefer";

const listingModes = ["snapshot", "delta"] as const;
type ListingMode = (typeof listingModes)[number];

const adapterVersion = 1;

const requestShapeFingerprint = (
  scope: ListingScope,
  mode: ListingMode,
  hash: (input: string) => string,
): string => {
  const { window: bounds, calendar } = scope;
  return hash(
    canonicalise({
      adapter: adapterVersion,
      mode,
      provider: calendar.provider,
      account: calendar.account.value,
      calendar: calendar.calendar.value,
      from: bounds.start.value,
      until: bounds.end.value,
      expandRecurrences: scope.expandRecurrences,
      prefer: [...microsoftPrefer],
    }),
  );
};

export { adapterVersion, listingModes, requestShapeFingerprint };
export type { ListingMode };
