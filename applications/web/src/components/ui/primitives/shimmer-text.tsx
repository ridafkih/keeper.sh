import type { PropsWithChildren } from "react";
import { cn } from "../../../utils/cn";

type ShimmerTextProps = PropsWithChildren<{
  className?: string;
}>;

export function ShimmerText({ children, className }: ShimmerTextProps) {
  return (
    <span
      className={cn(
        "bg-[linear-gradient(to_right,var(--color-foreground-muted)_0%,var(--color-foreground-muted)_35%,var(--color-foreground)_50%,var(--color-foreground-muted)_65%,var(--color-foreground-muted)_100%)] bg-size-[300%_100%] bg-clip-text text-transparent animate-shimmer",
        className,
      )}
    >
      {children}
    </span>
  );
}
