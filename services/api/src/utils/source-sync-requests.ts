const SYNC_REQUESTING_FIELDS = [
  "disableEventReminders",
] as const;

const updatesRequestUserSync = (updates: Record<string, unknown>): boolean =>
  SYNC_REQUESTING_FIELDS.some((field) => field in updates);

export { updatesRequestUserSync };
