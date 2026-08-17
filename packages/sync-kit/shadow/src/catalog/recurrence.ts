import type { EditableContent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { SourceIdentity } from "@keeper.sh/sync-reconcile";
import type { EntryTime, RecurrenceIdentity } from "./entries";

const recurrenceIdentityOf = (identity: SourceIdentity): RecurrenceIdentity => {
  switch (identity.kind) {
    case "master": {
      return { kind: "master" };
    }
    case "override": {
      return { kind: "override", recurrenceInstant: identity.recurrenceInstant };
    }
    case "slot": {
      return { kind: "slot", start: identity.start, end: identity.end };
    }
    default: {
      return assertNever(identity);
    }
  }
};

const timeOfIdentity = (identity: SourceIdentity): EntryTime => {
  switch (identity.kind) {
    case "master":
    case "override": {
      return { kind: "unrecorded" };
    }
    case "slot": {
      return {
        kind: "occurrence",
        time: { kind: "timed", start: identity.start, end: identity.end, zone: null },
      };
    }
    default: {
      return assertNever(identity);
    }
  }
};

const timeOfContent = (content: EditableContent): EntryTime => {
  if (!content.recurrence) {
    return { kind: "occurrence", time: content.time };
  }
  return { kind: "seriesAnchor", anchor: content.anchor };
};

export { recurrenceIdentityOf, timeOfContent, timeOfIdentity };
