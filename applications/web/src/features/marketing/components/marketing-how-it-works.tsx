import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { Text } from "@/components/ui/primitives/text";

export function MarketingHowItWorksSection({ children }: PropsWithChildren) {
  return <section className="w-full pt-16 pb-4">{children}</section>;
}

const ILLUSTRATION_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent 0 14px, var(--color-illustration-stripe) 14px 15px)",
} as const;

export function MarketingHowItWorksCard({ children }: PropsWithChildren) {
  return (
    <ol className="mt-8 grid grid-cols-1 auto-rows-[1fr] gap-px rounded-2xl overflow-hidden border border-interactive-border bg-interactive-border list-none">
      {children}
    </ol>
  );
}

export function MarketingHowItWorksRow({ children, className, reverse }: PropsWithChildren<{ className?: string; reverse?: boolean }>) {
  return (
    <li className={cn("grid grid-cols-1 sm:grid-cols-2", reverse && "*:first:sm:order-2 *:last:sm:order-1", className)}>
      {children}
    </li>
  );
}

export function MarketingHowItWorksStepBody({
  step,
  children,
}: PropsWithChildren<{ step: number }>) {
  return (
    <div className="bg-background flex flex-col justify-center gap-1 p-6 sm:p-8">
      <Text size="sm" tone="muted">{step}</Text>
      {children}
    </div>
  );
}

export function MarketingHowItWorksStepIllustration({ children, align }: PropsWithChildren<{ align?: "left" | "right" }>) {
  return (
    <div
      className={cn(
        "bg-background relative flex items-center justify-center min-h-48 select-none overflow-hidden",
        align && "items-start pt-6 sm:pt-6 sm:pb-6 sm:items-center",
        align === "left" && "sm:justify-start",
        align === "right" && "sm:justify-end",
      )}
      style={children ? undefined : ILLUSTRATION_STYLE}
      role="presentation"
      aria-hidden="true"
    >
      {children}
      {align && (
        <>
          <div
            className={cn(
              "absolute inset-y-0 w-16 pointer-events-none hidden sm:block",
              align === "right" && "right-0 bg-linear-to-r from-transparent to-background",
              align === "left" && "left-0 bg-linear-to-l from-transparent to-background",
            )}
          />
          <div className="absolute inset-x-0 bottom-0 h-12 pointer-events-none bg-linear-to-t from-background to-transparent sm:hidden" />
        </>
      )}
    </div>
  );
}
