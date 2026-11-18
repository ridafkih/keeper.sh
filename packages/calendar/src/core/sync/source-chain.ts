interface SyncMapping {
  destinationCalendarId: string;
  includeUpstreamSources: boolean;
  sourceCalendarId: string;
}

interface EffectiveSource {
  sourceCalendarId: string;
  viaCalendarIds: string[];
}

interface EffectiveMapping extends EffectiveSource {
  destinationCalendarId: string;
}

interface ChainStep {
  calendarId: string;
  viaCalendarIds: string[];
}

const bySourceCalendarId = (first: SyncMapping, second: SyncMapping): number =>
  first.sourceCalendarId.localeCompare(second.sourceCalendarId);

const byDestinationCalendarId = (first: SyncMapping, second: SyncMapping): number =>
  first.destinationCalendarId.localeCompare(second.destinationCalendarId);

const groupMappings = <TMapping extends SyncMapping>(
  mappings: readonly TMapping[],
  keyOf: (mapping: TMapping) => string,
  compare: (first: TMapping, second: TMapping) => number,
): Map<string, TMapping[]> => {
  const groups = new Map<string, TMapping[]>();
  for (const mapping of mappings) {
    const group = groups.get(keyOf(mapping)) ?? [];
    group.push(mapping);
    groups.set(keyOf(mapping), group);
  }
  for (const group of groups.values()) {
    group.sort(compare);
  }
  return groups;
};

const resolveEffectiveSources = (
  mappings: readonly SyncMapping[],
  destinationCalendarId: string,
): EffectiveSource[] => {
  const mappingsByDestination = groupMappings(
    mappings,
    (mapping) => mapping.destinationCalendarId,
    bySourceCalendarId,
  );
  const sources = new Map<string, EffectiveSource>();
  const expandedCalendarIds = new Set([destinationCalendarId]);
  let steps: ChainStep[] = [{ calendarId: destinationCalendarId, viaCalendarIds: [] }];

  while (steps.length > 0) {
    const upstreamSteps: ChainStep[] = [];
    for (const step of steps) {
      for (const mapping of mappingsByDestination.get(step.calendarId) ?? []) {
        const { sourceCalendarId } = mapping;
        if (sourceCalendarId === destinationCalendarId) {
          continue;
        }
        if (!sources.has(sourceCalendarId)) {
          sources.set(sourceCalendarId, {
            sourceCalendarId,
            viaCalendarIds: step.viaCalendarIds,
          });
        }
        if (mapping.includeUpstreamSources && !expandedCalendarIds.has(sourceCalendarId)) {
          expandedCalendarIds.add(sourceCalendarId);
          upstreamSteps.push({
            calendarId: sourceCalendarId,
            viaCalendarIds: [sourceCalendarId, ...step.viaCalendarIds],
          });
        }
      }
    }
    steps = upstreamSteps;
  }

  return [...sources.values()];
};

const resolveDownstreamDestinationIds = (
  mappings: readonly SyncMapping[],
  calendarId: string,
): string[] => {
  const mappingsBySource = groupMappings(
    mappings,
    (mapping) => mapping.sourceCalendarId,
    byDestinationCalendarId,
  );
  const downstreamCalendarIds = new Set<string>();
  let calendarIds = [calendarId];

  while (calendarIds.length > 0) {
    const nextCalendarIds: string[] = [];
    for (const currentCalendarId of calendarIds) {
      for (const mapping of mappingsBySource.get(currentCalendarId) ?? []) {
        const { destinationCalendarId } = mapping;
        if (
          !mapping.includeUpstreamSources
          || destinationCalendarId === calendarId
          || downstreamCalendarIds.has(destinationCalendarId)
        ) {
          continue;
        }
        downstreamCalendarIds.add(destinationCalendarId);
        nextCalendarIds.push(destinationCalendarId);
      }
    }
    calendarIds = nextCalendarIds;
  }

  return [...downstreamCalendarIds];
};

const resolveEffectiveDestinationIds = (
  mappings: readonly SyncMapping[],
  sourceCalendarId: string,
): string[] => {
  const directDestinationIds = mappings
    .filter((mapping) => mapping.sourceCalendarId === sourceCalendarId)
    .map((mapping) => mapping.destinationCalendarId)
    .toSorted();
  const destinationCalendarIds = new Set(directDestinationIds.flatMap((destinationCalendarId) => [
    destinationCalendarId,
    ...resolveDownstreamDestinationIds(mappings, destinationCalendarId),
  ]));
  destinationCalendarIds.delete(sourceCalendarId);

  return [...destinationCalendarIds];
};

const listEffectiveMappings = (mappings: readonly SyncMapping[]): EffectiveMapping[] => {
  const destinationCalendarIds = [...new Set(
    mappings.map((mapping) => mapping.destinationCalendarId),
  )].toSorted();

  return destinationCalendarIds.flatMap((destinationCalendarId) =>
    resolveEffectiveSources(mappings, destinationCalendarId).map((source) => ({
      ...source,
      destinationCalendarId,
    })));
};

const isInheritedSource = (source: EffectiveSource): boolean =>
  source.viaCalendarIds.length > 0;

export {
  isInheritedSource,
  listEffectiveMappings,
  resolveDownstreamDestinationIds,
  resolveEffectiveDestinationIds,
  resolveEffectiveSources,
};
export type { EffectiveMapping, EffectiveSource, SyncMapping };
