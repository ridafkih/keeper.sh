interface MappingPair {
  sourceCalendarId: string;
  destinationCalendarId: string;
}

interface SyncPairSummary {
  key: string;
  label: string;
  sourceCalendarId: string;
}

interface NamedCalendar {
  name: string;
}

interface SyncDirections<TCalendar extends NamedCalendar> {
  origin: TCalendar;
  destination: TCalendar;
  forward: boolean;
  backward: boolean;
}

const pairKey = ({ sourceCalendarId, destinationCalendarId }: MappingPair): string =>
  [sourceCalendarId, destinationCalendarId].sort().join(":");

const describeSyncPairs = (
  mappings: MappingPair[],
  namesById: Map<string, string>,
): SyncPairSummary[] => {
  const summaries = new Map<string, SyncPairSummary>();

  for (const mapping of mappings) {
    const key = pairKey(mapping);
    const sourceName = namesById.get(mapping.sourceCalendarId);
    const destinationName = namesById.get(mapping.destinationCalendarId);
    if (summaries.has(key) || !sourceName || !destinationName) continue;

    const twoWay = mappings.some((other) =>
      other.sourceCalendarId === mapping.destinationCalendarId
      && other.destinationCalendarId === mapping.sourceCalendarId);
    const joiner = twoWay ? "and" : "to";
    summaries.set(key, {
      key,
      label: `${sourceName} ${joiner} ${destinationName}`,
      sourceCalendarId: mapping.sourceCalendarId,
    });
  }

  return [...summaries.values()];
};

const describeProposal = <TCalendar extends NamedCalendar>(
  { origin, destination, forward, backward }: SyncDirections<TCalendar>,
): string => {
  if (forward && backward) {
    return `${origin.name} and ${destination.name} will each show you as busy whenever the other has an event.`;
  }
  if (forward) {
    return `${destination.name} will show you as busy whenever ${origin.name} has an event.`;
  }
  return `${origin.name} will show you as busy whenever ${destination.name} has an event.`;
};

export { describeProposal, describeSyncPairs };
export type { MappingPair, SyncDirections, SyncPairSummary };
