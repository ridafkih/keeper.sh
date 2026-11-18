import type { EventMapping } from "../events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../types";
import type { CalendarSyncProvider, EventUpdate } from "../sync-engine/types";

interface OwnershipScope {
  ownerTag: string;
  provenUntaggedUids: ReadonlySet<string>;
}

/*
 * An untagged event is only this destination's when its UID is one this destination derives
 * for an event it mirrors right now. Anything else untagged may belong to another Keeper.sh
 * destination writing into the same calendar, and deleting it starts a war between the two.
 */
const buildOwnershipScope = (
  provider: Pick<CalendarSyncProvider, "deriveEventUids" | "ownerTag">,
  localEvents: MaterializedSyncableEvent[],
): OwnershipScope | null => {
  const { deriveEventUids, ownerTag } = provider;
  if (!ownerTag || !deriveEventUids) {
    return null;
  }
  return {
    ownerTag,
    provenUntaggedUids: new Set(localEvents.flatMap((event) => deriveEventUids(event))),
  };
};

const isOwnedOrphan = (remoteEvent: RemoteEvent, ownership?: OwnershipScope): boolean => {
  if (!ownership || !("ownerTag" in remoteEvent)) {
    return true;
  }
  if (remoteEvent.ownerTag === null) {
    return ownership.provenUntaggedUids.has(remoteEvent.uid);
  }
  return remoteEvent.ownerTag === ownership.ownerTag;
};

interface OwnerTagBackfillInput {
  excludedMappingIds: ReadonlySet<string>;
  limit: number;
  localEventsById: ReadonlyMap<string, MaterializedSyncableEvent>;
  ownerTag: string;
  remoteEvents: RemoteEvent[];
  remoteEventsByMappingId: ReadonlyMap<string, RemoteEvent>;
  mappings: EventMapping[];
}

/*
 * Until one tag has been seen to survive a round trip on this calendar, only one event is
 * claimed per run, so a server that drops the tag costs one rewrite per run rather than the
 * whole calendar every run.
 */
const resolveBackfillBudget = (input: OwnerTagBackfillInput): number => {
  const tagSurvives = input.remoteEvents.some((event) => event.ownerTag === input.ownerTag);
  if (tagSurvives) {
    return input.limit;
  }
  return Math.min(input.limit, 1);
};

const selectOwnerTagBackfill = (input: OwnerTagBackfillInput): EventUpdate[] => {
  const budget = resolveBackfillBudget(input);
  const updates: EventUpdate[] = [];
  for (const mapping of input.mappings) {
    if (updates.length >= budget) {
      break;
    }
    if (input.excludedMappingIds.has(mapping.id)) {
      continue;
    }
    const remoteEvent = input.remoteEventsByMappingId.get(mapping.id);
    const event = input.localEventsById.get(mapping.syncEventId);
    if (!remoteEvent || !event || remoteEvent.ownerTag !== null) {
      continue;
    }
    updates.push({ deleteId: remoteEvent.deleteId, event });
  }
  return updates;
};

export { buildOwnershipScope, isOwnedOrphan, selectOwnerTagBackfill };
export type { OwnerTagBackfillInput, OwnershipScope };
