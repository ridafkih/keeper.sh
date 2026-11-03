type MappingChange =
  | { kind: "replace"; calendarIds: string[] }
  | { kind: "toggle"; calendarId: string; enabled: boolean };

interface MappingChangeResult {
  previousIds: string[];
  nextIds: string[];
}

const resolveMappedIds = (currentIds: string[], change: MappingChange): string[] => {
  if (change.kind === "replace") {
    return [...new Set(change.calendarIds)];
  }
  if (change.enabled) {
    return [...new Set([...currentIds, change.calendarId])];
  }
  return currentIds.filter((calendarId) => calendarId !== change.calendarId);
};

const listChangeCalendarIds = (change: MappingChange): string[] => {
  if (change.kind === "replace") {
    return change.calendarIds;
  }
  return [change.calendarId];
};

const listNewlyMappedIds = (result: MappingChangeResult): string[] => {
  const previous = new Set(result.previousIds);
  return result.nextIds.filter((calendarId) => !previous.has(calendarId));
};

const listNewlyMappedSourcesOfSource = (
  sourceCalendarId: string,
  result: MappingChangeResult,
): string[] => {
  if (listNewlyMappedIds(result).length === 0) {
    return [];
  }
  return [sourceCalendarId];
};

const describeMappingChange = (
  change: MappingChange,
  result: MappingChangeResult,
): Record<string, number | string> => {
  const previous = new Set(result.previousIds);
  const next = new Set(result.nextIds);
  return {
    "mappings.added_count": result.nextIds.filter((calendarId) => !previous.has(calendarId)).length,
    "mappings.after_count": result.nextIds.length,
    "mappings.before_count": result.previousIds.length,
    "mappings.change": change.kind,
    "mappings.removed_count": result.previousIds.filter((calendarId) => !next.has(calendarId)).length,
  };
};

export {
  describeMappingChange,
  listChangeCalendarIds,
  listNewlyMappedIds,
  listNewlyMappedSourcesOfSource,
  resolveMappedIds,
};
export type { MappingChange, MappingChangeResult };
