import { assertNever } from "@keeper.sh/sync-protocol";
import type { DecodedFields, DecodedItem } from "../decode/decode-event";
import { compareCodeUnits } from "../canonical";

interface ArrivedItem {
  readonly item: DecodedItem;
  readonly arrival: number;
  readonly fields: DecodedFields;
}

interface CollapsedRevisions {
  readonly kept: readonly DecodedItem[];
  readonly discarded: number;
}

const parsedInstant = (value: string | null): number => {
  if (value === null) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
};

const identityOf = (arrived: ArrivedItem): string | null => {
  const { item } = arrived;
  switch (item.kind) {
    case "decoded": {
      return `id:${item.event.id.value}`;
    }
    case "undecodable": {
      if (item.identity.id !== null) {
        return `id:${item.identity.id.value}`;
      }
      if (item.identity.uid === null) {
        return null;
      }
      return `uid:${item.identity.uid.value}`;
    }
    case "tombstone":
    case "discarded": {
      return null;
    }
    default: {
      return assertNever(item);
    }
  }
};

const newerOf = (held: ArrivedItem, candidate: ArrivedItem): ArrivedItem => {
  const modified =
    parsedInstant(candidate.fields.lastModifiedDateTime) -
    parsedInstant(held.fields.lastModifiedDateTime);
  if (modified !== 0) {
    if (modified > 0) {
      return candidate;
    }
    return held;
  }
  const created =
    parsedInstant(candidate.fields.createdDateTime) - parsedInstant(held.fields.createdDateTime);
  if (created !== 0) {
    if (created > 0) {
      return candidate;
    }
    return held;
  }
  if (candidate.arrival > held.arrival) {
    return candidate;
  }
  return held;
};

const supersededReading = (item: DecodedItem): DecodedItem => {
  if (item.kind !== "undecodable") {
    return item;
  }
  return { ...item, reason: "supersededRevisionUnbuildable" };
};

const collapseRevisions = (arrived: readonly ArrivedItem[]): CollapsedRevisions => {
  const winners = new Map<string, ArrivedItem>();
  const collided = new Set<string>();
  const passthrough: DecodedItem[] = [];
  const dropped = { discarded: 0 };

  for (const entry of arrived) {
    const identity = identityOf(entry);
    if (identity === null) {
      passthrough.push(entry.item);
      continue;
    }
    const held = winners.get(identity);
    if (!held) {
      winners.set(identity, entry);
      continue;
    }
    collided.add(identity);
    dropped.discarded += 1;
    winners.set(identity, newerOf(held, entry));
  }

  const ordered = [...winners.entries()].toSorted((left, right) =>
    compareCodeUnits(left[0], right[0]),
  );
  const kept = ordered.map(([identity, entry]) => {
    if (!collided.has(identity)) {
      return entry.item;
    }
    return supersededReading(entry.item);
  });

  return { kept: [...kept, ...passthrough], discarded: dropped.discarded };
};

export { collapseRevisions };
export type { ArrivedItem, CollapsedRevisions };
