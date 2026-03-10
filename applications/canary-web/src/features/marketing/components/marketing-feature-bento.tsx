import type { PropsWithChildren } from "react";
import { cn } from "../../../utils/cn";

type MarketingFeatureBentoCardProps = PropsWithChildren<{ className?: string }>;

export function MarketingFeatureBentoSection({ children }: PropsWithChildren) {
  return <section className="w-full md:px-0 bg-background z-20">{children}</section>;
}

export function MarketingFeatureBentoGrid({ children }: PropsWithChildren) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-10 gap-px border border-interactive-border rounded-2xl overflow-hidden bg-interactive-border">
      {children}
    </div>
  );
}

export function MarketingFeatureBentoCard({
  children,
  className,
}: MarketingFeatureBentoCardProps) {
  return (
    <article className={cn("flex flex-col h-full bg-background", className)}>
      {children}
    </article>
  );
}

const ILLUSTRATION_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent 0 14px, var(--color-illustration-stripe) 14px 15px)",
} as const;

type MarketingFeatureBentoIllustrationProps = PropsWithChildren<{
  plain?: boolean;
}>;

export function MarketingFeatureBentoIllustration({ children, plain }: MarketingFeatureBentoIllustrationProps) {
  return (
    <div
      className="bg-background flex items-center justify-center py-4 min-h-32 flex-1 select-none"
      style={plain ? undefined : ILLUSTRATION_STYLE}
      role="presentation"
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

export function MarketingFeatureBentoBody({ children }: PropsWithChildren) {
  return <div className="flex flex-col gap-2 p-4 pt-0 md:p-6 md:pt-0 mt-auto">{children}</div>;
}
