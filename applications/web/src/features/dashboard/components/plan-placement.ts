interface PlanPlacementInput {
  isPro: boolean;
  hasConfiguredSync: boolean;
}

export function isPlanShownOnHome({ isPro, hasConfiguredSync }: PlanPlacementInput): boolean {
  return isPro || hasConfiguredSync;
}
