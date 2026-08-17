import type {
  EditableContent,
  EventUid,
  InstallationId,
  ListingScope,
  Removal,
  RemoteEvent,
  TimeWindow,
  WithheldEvent,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { DecodedItem } from "../decode/decode-event";
import type { RemovedReading } from "../decode/removed";
import { withinMicrosoftWindow } from "../window/membership";

interface FeedInputs {
  readonly items: readonly DecodedItem[];
  readonly scope: ListingScope;
  readonly installation: InstallationId;
}

interface BuiltFeed {
  readonly events: readonly RemoteEvent[];
  readonly removals: readonly Removal[];
  readonly withheld: readonly WithheldEvent[];
  readonly selfAuthored: readonly string[];
  readonly discarded: number;
}

const staysInScope = (bounds: TimeWindow, content: EditableContent): boolean => {
  if (content.recurrence !== null) {
    return true;
  }
  return withinMicrosoftWindow(bounds, content.time);
};

const writtenByUs = (event: RemoteEvent, installation: InstallationId): boolean =>
  event.provenance.kind === "ours" && event.provenance.installation.value === installation.value;

const uidsByIdentifier = (items: readonly DecodedItem[]): ReadonlyMap<string, EventUid> => {
  const known = new Map<string, EventUid>();
  for (const item of items) {
    if (item.kind === "decoded") {
      known.set(item.event.id.value, item.event.uid);
    }
  }
  return known;
};

const removalOf = (
  removal: RemovedReading,
  uid: EventUid | null,
  known: ReadonlyMap<string, EventUid>,
): Removal | null => {
  switch (removal.kind) {
    case "untyped": {
      if (removal.id === null) {
        return null;
      }
      return { kind: "outOfScope", id: removal.id };
    }
    case "deleted":
    case "cancelled": {
      const named = uid ?? known.get(removal.id.value) ?? null;
      if (named === null) {
        return { kind: "outOfScope", id: removal.id };
      }
      return { kind: removal.kind, id: removal.id, uid: named };
    }
    case "notRemoved": {
      return null;
    }
    default: {
      return assertNever(removal);
    }
  }
};

const buildFeed = (inputs: FeedInputs): BuiltFeed => {
  const { window: bounds } = inputs.scope;
  const known = uidsByIdentifier(inputs.items);
  const events: RemoteEvent[] = [];
  const removals: Removal[] = [];
  const withheld: WithheldEvent[] = [];
  const selfAuthored: string[] = [];
  const dropped = { discarded: 0 };

  for (const item of inputs.items) {
    switch (item.kind) {
      case "decoded": {
        if (!staysInScope(bounds, item.event.content)) {
          removals.push({ kind: "outOfScope", id: item.event.id });
          break;
        }
        events.push(item.event);
        if (writtenByUs(item.event, inputs.installation)) {
          selfAuthored.push(item.event.uid.value);
        }
        break;
      }
      case "tombstone": {
        const removal = removalOf(item.removal, item.uid, known);
        if (removal !== null) {
          removals.push(removal);
        }
        break;
      }
      case "undecodable": {
        withheld.push({ ...item.identity, reason: item.reason });
        break;
      }
      case "discarded": {
        dropped.discarded += 1;
        break;
      }
      default: {
        assertNever(item);
      }
    }
  }

  return { events, removals, withheld, selfAuthored, discarded: dropped.discarded };
};

export { buildFeed };
export type { BuiltFeed, FeedInputs };
