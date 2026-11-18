const SYNC_REQUESTING_FIELDS = [
  "markEventsAsPrivate",
  "disableEventReminders",
  "excludeAvailabilities",
  "excludeTitleKeywords",
] as const;

const updatesRequestUserSync = (updates: Record<string, unknown>): boolean =>
  SYNC_REQUESTING_FIELDS.some((field) => field in updates);

export { updatesRequestUserSync };
