interface MappingPair {
  sourceCalendarId: string;
  destinationCalendarId: string;
}

interface SyncPairSummary {
  key: string;
  label: string;
  sourceCalendarId: string;
  busyOnly: boolean;
}

interface NamedCalendar {
  name: string;
}

interface PairedCalendar extends NamedCalendar {
  excludeEventName: boolean;
}

interface SyncDirections<TCalendar extends NamedCalendar> {
  origin: TCalendar;
  destination: TCalendar;
  forward: boolean;
  backward: boolean;
}

const pairKey = ({ sourceCalendarId, destinationCalendarId }: MappingPair): string =>
  [sourceCalendarId, destinationCalendarId].sort().join(":");

const isReverseOf = (mapping: MappingPair) => (other: MappingPair): boolean =>
  other.sourceCalendarId === mapping.destinationCalendarId
  && other.destinationCalendarId === mapping.sourceCalendarId;

const describeSyncPairs = (
  mappings: MappingPair[],
  calendarsById: ReadonlyMap<string, PairedCalendar>,
): SyncPairSummary[] => {
  const summaries = new Map<string, SyncPairSummary>();

  for (const mapping of mappings) {
    const key = pairKey(mapping);
    const source = calendarsById.get(mapping.sourceCalendarId);
    const destination = calendarsById.get(mapping.destinationCalendarId);
    if (summaries.has(key) || !source || !destination) continue;

    const twoWay = mappings.some(isReverseOf(mapping));
    const joiner = twoWay ? "and" : "to";
    const senders = twoWay ? [source, destination] : [source];
    summaries.set(key, {
      busyOnly: senders.every(({ excludeEventName }) => excludeEventName),
      key,
      label: `${source.name} ${joiner} ${destination.name}`,
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
export type { MappingPair, PairedCalendar, SyncDirections, SyncPairSummary };
