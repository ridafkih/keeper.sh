import type { PropsWithChildren } from "react";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { Text } from "@/components/ui/primitives/text";
import { MarketingFaqItem, MarketingFaqList, MarketingFaqQuestion } from "./marketing-faq";

export function MarkdownFaq({ children }: PropsWithChildren) {
  return <MarketingFaqList>{children}</MarketingFaqList>;
}

export function MarkdownFaqItem({
  children,
  question,
}: PropsWithChildren<{ question?: string }>) {
  if (!question) {
    throw new Error("A faq-item in markdown content is missing its question attribute.");
  }

  return (
    <MarketingFaqItem>
      <Collapsible trigger={<MarketingFaqQuestion>{question}</MarketingFaqQuestion>}>
        <Text size="sm" tone="muted">
          {children}
        </Text>
      </Collapsible>
    </MarketingFaqItem>
  );
}
