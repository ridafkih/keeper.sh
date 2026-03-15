import type { PropsWithChildren } from "react";
import { Text } from "../../../components/ui/primitives/text";

export function MarketingFaqSection({ children }: PropsWithChildren) {
  return <section className="w-full max-w-lg mx-auto pt-16 pb-4">{children}</section>;
}

export function MarketingFaqList({ children }: PropsWithChildren) {
  return (
    <div className="mt-8 flex flex-col gap-1">
      {children}
    </div>
  );
}

export function MarketingFaqItem({ children }: PropsWithChildren) {
  return (
    <div className="rounded-2xl p-0.5 bg-background-elevated border border-border-elevated shadow-xs">
      {children}
    </div>
  );
}

export function MarketingFaqQuestion({ children }: PropsWithChildren) {
  return (
    <Text as="span" size="sm">{children}</Text>
  );
}
