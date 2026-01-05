import { tv } from "tailwind-variants";

const button = tv({
  base: "inline-flex items-center justify-center rounded-md font-medium no-underline cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-emphasis disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-border-input",
  defaultVariants: {
    size: "default",
  },
  variants: {
    size: {
      default: "py-2 px-4 text-sm",
      sm: "py-1.5 px-3 text-sm",
      xs: "py-1.5 px-3 text-xs",
    },
    skeleton: {
      true: "opacity-0",
    },
    variant: {
      danger:
        "bg-transparent border border-destructive-border text-destructive hover:bg-destructive-surface",
      ghost:
        "bg-transparent border-none text-foreground-muted hover:text-foreground hover:bg-surface-subtle",
      primary:
        "bg-primary border border-primary text-primary-foreground hover:bg-primary-hover hover:border-primary-hover disabled:hover:bg-primary disabled:hover:border-primary",
      secondary:
        "bg-transparent border border-border-input text-foreground hover:bg-surface-subtle hover:border-foreground-subtle",
    },
  },
});

const input = tv({
  base: "w-full border border-border-input rounded-md text-foreground transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-border-emphasis focus:ring-3 focus:ring-focus-ring",
  defaultVariants: {
    size: "default",
  },
  variants: {
    readonly: {
      true: "bg-surface-subtle text-foreground-secondary",
    },
    size: {
      default: "py-2.5 px-3 text-base",
      sm: "py-1.5 px-2 text-sm",
    },
  },
});

const dialogPopup = tv({
  base: "fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-elevated border border-border rounded-md shadow-lg p-4 w-full",
  defaultVariants: {
    size: "sm",
  },
  variants: {
    size: {
      lg: "max-w-md",
      md: "max-w-sm",
      sm: "max-w-xs",
    },
  },
});

export { button, input, dialogPopup };
