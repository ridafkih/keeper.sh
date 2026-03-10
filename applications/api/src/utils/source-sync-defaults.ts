const DEFAULT_SOURCE_SYNC_RULES = {
  customEventName: "{{calendar_name}}",
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  includeInIcalFeed: true,
} as const;

const applySourceSyncDefaults = <TValues extends object>(
  values: TValues,
): TValues & typeof DEFAULT_SOURCE_SYNC_RULES => ({
  ...DEFAULT_SOURCE_SYNC_RULES,
  ...values,
});

export { DEFAULT_SOURCE_SYNC_RULES, applySourceSyncDefaults };
