import type { PropsWithChildren } from "react";
import { cn } from "tailwind-variants/lite";

type TextProps = PropsWithChildren<{ className?: string }>;

export function Text({ children, className }: TextProps) {
  return <p className={cn("tracking-tight text-foreground-muted text-center", className)()}>{children}</p>;
}
