import type { EventUid, Instant } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

type EventIdentity =
  | { readonly kind: "master"; readonly uid: EventUid }
  | { readonly kind: "override"; readonly uid: EventUid; readonly recurrenceInstant: Instant }
  | { readonly kind: "slot"; readonly uid: EventUid; readonly start: Instant; readonly end: Instant };

const eventIdentityKey = (identity: EventIdentity): string => {
  switch (identity.kind) {
    case "master": {
      return `master|${identity.uid.value}`;
    }
    case "override": {
      return `override|${identity.uid.value}|${identity.recurrenceInstant.value}`;
    }
    case "slot": {
      return `slot|${identity.uid.value}|${identity.start.value}|${identity.end.value}`;
    }
    default: {
      return assertNever(identity);
    }
  }
};

export { eventIdentityKey };
export type { EventIdentity };
