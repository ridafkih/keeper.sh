import type { CanonicalEvent } from "@keeper.sh/sync-ical";
import { IcsInternalDataError, parseStoredCanonicalEvent } from "@keeper.sh/sync-ical";

type StoredDecoding =
  | { readonly kind: "decoded"; readonly canonical: CanonicalEvent }
  | { readonly kind: "corrupt" };

type DecodeStoredEvent = (canonical: unknown) => StoredDecoding;

const decodeStoredCanonicalEvent: DecodeStoredEvent = (canonical) => {
  try {
    return { kind: "decoded", canonical: parseStoredCanonicalEvent(canonical) };
  } catch (error) {
    if (error instanceof IcsInternalDataError) {
      return { kind: "corrupt" };
    }
    throw error;
  }
};

export { decodeStoredCanonicalEvent };
export type { DecodeStoredEvent, StoredDecoding };
