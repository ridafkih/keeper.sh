import type { CSSProperties, PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

const text = tv({
  base: "tracking-tight",
  variants: {
    size: {
      base: "text-base",
      sm: "text-sm",
      xs: "text-xs",
    },
    tone: {
      muted: "text-foreground-muted",
      disabled: "text-foreground-disabled",
      highlight: "text-white",
      inverse: "text-foreground-inverse",
      inverseMuted: "text-foreground-inverse-muted",
      default: "text-foreground",
      danger: "text-red-500",
      amber: "text-amber-700 dark:text-white",
      blue: "text-blue-600 dark:text-blue-200",
      emerald: "text-emerald-600 dark:text-emerald-300",
    },
    align: {
      center: "text-center",
      left: "text-left",
      right: "text-right",
    },
  },
  defaultVariants: {
    size: "base",
    tone: "muted",
    align: "left",
  },
});

type TextProps = PropsWithChildren<{
  as?: "p" | "span";
  size?: "base" | "sm" | "xs";
  tone?: "muted" | "disabled" | "inverse" | "inverseMuted" | "default" | "danger" | "highlight" | "amber" | "blue" | "emerald";
  align?: "center" | "left" | "right";
  className?: string;
  style?: CSSProperties;
}>;

export function Text({ as = "p", children, size, tone, align, className, style }: TextProps) {
  const Element = as;
  return <Element className={text({ size, tone, align, className })} style={style}>{children}</Element>;
}
