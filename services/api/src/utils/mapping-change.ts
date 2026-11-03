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

export {
  listChangeCalendarIds,
  listNewlyMappedIds,
  listNewlyMappedSourcesOfSource,
  resolveMappedIds,
};
export type { MappingChange, MappingChangeResult };
