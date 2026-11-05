import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const listingAuthorities = ["wholeScope", "namedRemovalsOnly", "none"] as const;
type ListingAuthority = (typeof listingAuthorities)[number];

const listingAuthority = (listing: ChangeListing): ListingAuthority => {
  switch (listing.kind) {
    case "snapshot": {
      return "wholeScope";
    }
    case "delta": {
      return "namedRemovalsOnly";
    }
    case "partial":
    case "cursorLost": {
      return "none";
    }
    default: {
      return assertNever(listing);
    }
  }
};

const speaksForAbsence = (authority: ListingAuthority): boolean => authority === "wholeScope";

const mayRetireItsOwnMirrors = (authority: ListingAuthority): boolean => authority !== "none";

export { listingAuthorities, listingAuthority, mayRetireItsOwnMirrors, speaksForAbsence };
export type { ListingAuthority };
