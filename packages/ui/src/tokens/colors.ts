/**
 * Color tokens for the UI library
 * These map to Tailwind's neutral scale and semantic colors
 */

export const TEXT_COLORS = {
  primary: "text-foreground",
  secondary: "text-foreground-secondary",
  tertiary: "text-foreground-muted",
  muted: "text-foreground-subtle",
  error: "text-red-600",
  success: "text-green-600",
  warning: "text-amber-600",
} as const;

export const BACKGROUND_COLORS = {
  primary: "bg-surface",
  secondary: "bg-surface-subtle",
  tertiary: "bg-surface-muted",
  muted: "bg-surface-skeleton",
  error: "bg-red-50",
  success: "bg-green-50",
  warning: "bg-amber-50",
} as const;

export const BORDER_COLORS = {
  default: "border",
  light: "border-input",
  medium: "border-input",
  dark: "border",
  error: "border-red-400",
  success: "border-green-400",
  warning: "border-amber-400",
} as const;

export const ICON_COLORS = {
  primary: "text-foreground",
  secondary: "text-foreground-secondary",
  tertiary: "text-foreground-muted",
  muted: "text-foreground-subtle",
  error: "text-red-400",
  success: "text-green-400",
  warning: "text-amber-400",
} as const;
