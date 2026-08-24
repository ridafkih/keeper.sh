import type { PropsWithChildren, ReactNode } from "react";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";

export function MarketingToolSection({ children }: PropsWithChildren) {
  return <section className="w-full pt-8">{children}</section>;
}

export function MarketingToolGrid({ children }: PropsWithChildren) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">{children}</div>;
}

export function MarketingToolPanel({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border-elevated bg-background-elevated shadow-xs p-6">
      {children}
    </div>
  );
}

type MarketingToolFieldProps = PropsWithChildren<{
  htmlFor: string;
  label: string;
  hint?: ReactNode;
}>;

export function MarketingToolField({ children, htmlFor, label, hint }: MarketingToolFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm tracking-tight text-foreground">{label}</label>
      {children}
      {hint && <Text size="xs">{hint}</Text>}
    </div>
  );
}

export function MarketingToolActions({ children }: PropsWithChildren) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

type MarketingToolCtaProps = {
  title: string;
  body: string;
  source: string;
};

export function MarketingToolCta({ title, body, source }: MarketingToolCtaProps) {
  return (
    <MarketingCtaSection>
      <MarketingCtaCard>
        <Heading2 className="text-center text-white">{title}</Heading2>
        <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
          {body}
        </Text>
        <div className="flex items-center gap-2 mt-2">
          <LinkButton
            to="/register"
            size="compact"
            variant="inverse"
            data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
            data-visitors-cta={source}
          >
            <ButtonText>Start Syncing Calendars</ButtonText>
            <ButtonIcon>
              <ArrowRightIcon size={16} />
            </ButtonIcon>
          </LinkButton>
          <LinkButton to="/features" size="compact" variant="inverse-ghost">
            <ButtonText>See the Features</ButtonText>
          </LinkButton>
        </div>
      </MarketingCtaCard>
    </MarketingCtaSection>
  );
}
