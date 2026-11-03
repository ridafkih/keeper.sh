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

export { listChangeCalendarIds, resolveMappedIds };
export type { MappingChange, MappingChangeResult };
