import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

const text = tv({
  base: "tracking-tight text-foreground-muted text-center",
  variants: {
    size: {
      base: "text-base",
      sm: "text-sm",
    },
  },
  defaultVariants: {
    size: "base",
  },
});

type TextProps = PropsWithChildren<{ size?: "base" | "sm"; className?: string }>;

export function Text({ children, size, className }: TextProps) {
  return <p className={text({ size, className })}>{children}</p>;
}
