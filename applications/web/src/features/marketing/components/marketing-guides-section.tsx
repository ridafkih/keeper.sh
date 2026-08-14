import type { PropsWithChildren } from "react";
import { Link } from "@tanstack/react-router";
import { Text } from "@/components/ui/primitives/text";

export function MarketingGuidesSection({ children }: PropsWithChildren) {
  return <section className="w-full pt-16 pb-4">{children}</section>;
}

export function MarketingGuidesGrid({ children }: PropsWithChildren) {
  return (
    <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 list-none">
      {children}
    </ul>
  );
}

export function MarketingGuideCard({
  blurb,
  path,
  title,
}: {
  blurb: string;
  path: string;
  title: string;
}) {
  return (
    <li>
      <Link
        className="group flex h-full flex-col gap-1 rounded-2xl border border-interactive-border bg-background p-4 shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to={path}
      >
        <Text size="sm" tone="default" className="group-hover:text-foreground-hover">
          {title}
        </Text>
        <Text size="sm" tone="muted" className="line-clamp-2">
          {blurb}
        </Text>
      </Link>
    </li>
  );
}
