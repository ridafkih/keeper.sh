export const TYPOGRAPHY = {
  label: "text-sm font-medium text-foreground",
  secondaryXs: "text-xs text-foreground-subtle",
  secondaryXsMedium: "text-xs font-medium text-foreground-subtle",
  secondarySmMedium: "text-sm font-medium text-foreground-secondary",
  stepCounter: "text-xs font-medium text-foreground-secondary",
  stepDescription: "text-xs text-foreground-muted",
  calendarLabel: "font-mono text-[0.625rem] text-foreground-subtle leading-none",
  error: "text-xs text-red-600",
} as const;

export const TEXT_COLORS = {
  primary: "text-foreground",
  secondary: "text-foreground-secondary",
  tertiary: "text-foreground-muted",
  muted: "text-foreground-subtle",
  error: "text-red-600",
  success: "text-green-600",
} as const;
