import type { ChangeListing, RemoteEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const writeBasis = (listing: ChangeListing): readonly RemoteEvent[] => {
  switch (listing.kind) {
    case "snapshot":
    case "delta": {
      return listing.events;
    }
    case "partial":
    case "cursorLost": {
      return [];
    }
    default: {
      return assertNever(listing);
    }
  }
};

export { writeBasis };
