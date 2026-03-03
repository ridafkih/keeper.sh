import type { PropsWithChildren } from "react";
import { cn } from "tailwind-variants/lite";

type MarketingFeatureBentoCardProps = PropsWithChildren<{ className?: string }>;

export function MarketingFeatureBentoSection({ children }: PropsWithChildren) {
  return <section className="w-full px-2 md:px-0 bg-background z-20">{children}</section>;
}

export function MarketingFeatureBentoGrid({ children }: PropsWithChildren) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-10 gap-px border border-interactive-border rounded-3xl overflow-hidden bg-interactive-border">
      {children}
    </div>
  );
}

export function MarketingFeatureBentoCard({
  children,
  className,
}: MarketingFeatureBentoCardProps) {
  return (
    <article className={cn("flex flex-col h-full bg-background", className)()}>
      {children}
    </article>
  );
}

export function MarketingFeatureBentoIllustration({ children }: PropsWithChildren) {
  return (
    <div
      className="bg-background flex items-center justify-center p-12 min-h-32"
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, transparent 0 14px, color-mix(in srgb, var(--color-foreground), transparent 92%) 14px 15px)",
      }}
    >
      {children}
    </div>
  );
}

export function MarketingFeatureBentoBody({ children }: PropsWithChildren) {
  return <div className="flex flex-col gap-2 p-4 md:p-6">{children}</div>;
}
