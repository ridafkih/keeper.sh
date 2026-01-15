export const FOCUS_RING = {
  button: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-input focus-visible:ring-offset-2",
  input: "focus:outline-none focus:border-input focus:ring-2 focus:ring-border",
  checkbox: "peer-focus:ring-2 peer-focus:ring-border peer-focus:border-input",
} as const;

export const DISABLED = {
  button: "disabled:opacity-50 disabled:cursor-not-allowed",
  input: "disabled:bg-surface-muted disabled:text-foreground-subtle disabled:cursor-not-allowed",
  label: "cursor-not-allowed opacity-50",
} as const;

export const BORDER_RADIUS = {
  default: "rounded-xl",
  button: "rounded-xl",
  input: "rounded-xl",
  card: "rounded-2xl",
} as const;
