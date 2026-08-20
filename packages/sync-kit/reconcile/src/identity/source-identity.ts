import type { EventUid } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { EventIdentity } from "@keeper.sh/sync-ical";
import { joinOnNul } from "./nul";

type SourceIdentity = EventIdentity;

const sourceIdentityKey = (identity: SourceIdentity): string => {
  switch (identity.kind) {
    case "master": {
      return joinOnNul(["master", identity.uid.value]);
    }
    case "override": {
      return joinOnNul(["override", identity.uid.value, identity.recurrenceInstant.value]);
    }
    case "slot": {
      return joinOnNul(["slot", identity.uid.value, identity.start.value, identity.end.value]);
    }
    default: {
      return assertNever(identity);
    }
  }
};

const uidPresenceKey = (uid: EventUid): string => joinOnNul(["uid", uid.value]);

export { sourceIdentityKey, uidPresenceKey };
export type { SourceIdentity };
