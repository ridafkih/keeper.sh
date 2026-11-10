import type { PropsWithChildren } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import {
  MarketingFaqItem,
  MarketingFaqList,
  MarketingFaqQuestion,
  MarketingFaqSection,
} from "@/features/marketing/components/marketing-faq";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail, faqSchema } from "@/lib/seo";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { marketingCopy } from "@/lib/marketing-copy";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";

const PAGE_PATH = "/free";

const free = marketingCopy.free;
const breadcrumbs = breadcrumbTrail({ name: free.header.heading, path: PAGE_PATH });

export const Route = createFileRoute("/(marketing)/free")({
  component: FreePage,
  head: () => seoHead({
    title: free.seo.title,
    description: free.seo.description,
    path: PAGE_PATH,
    scripts: [
      jsonLdScript(webPageSchema(free.seo.title, free.seo.description, PAGE_PATH)),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(faqSchema(PAGE_PATH, free.faq.items)),
    ],
  }),
});

function FreeSection({ children }: PropsWithChildren) {
  return <section className="flex flex-col gap-2 pt-10">{children}</section>;
}

function FreeSectionBody({ children }: PropsWithChildren) {
  return <Text size="sm" tone="muted" className="max-w-[64ch]">{children}</Text>;
}

function FreeList({ children, ordered }: PropsWithChildren<{ ordered?: boolean }>) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className="mt-4 flex flex-col divide-y divide-interactive-border border border-interactive-border rounded-2xl overflow-hidden">
      {children}
    </List>
  );
}

function FreeListRow({ children }: PropsWithChildren) {
  return <li className="flex flex-col gap-1.5 p-4 md:p-6 bg-background">{children}</li>;
}

function FreeListRowTitle({ children, to }: PropsWithChildren<{ to?: string }>) {
  if (!to) return children;

  return (
    <Link
      to={to}
      className="rounded-sm underline underline-offset-4 hover:text-foreground-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function FreeListRowHeading({ children, trailing, to }: PropsWithChildren<{ trailing?: string; to?: string }>) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Heading3 as="h3">
        <FreeListRowTitle to={to}>{children}</FreeListRowTitle>
      </Heading3>
      {trailing && <Text as="span" size="sm" tone="default">{trailing}</Text>}
    </div>
  );
}

function FreePage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col items-start gap-1.5">
        <Heading1>{free.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {free.header.body}
        </Text>
        <LinkButton
          to="/register"
          size="compact"
          className="mt-3"
          data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
          data-visitors-cta="free-header"
        >
          <ButtonText>{free.header.ctaLabel}</ButtonText>
          <ButtonIcon>
            <ArrowRightIcon size={16} />
          </ButtonIcon>
        </LinkButton>
      </header>

      <FreeSection>
        <Heading2>{free.includes.heading}</Heading2>
        <FreeSectionBody>{free.includes.body}</FreeSectionBody>
        <FreeList>
          {free.includes.items.map((item) => (
            <FreeListRow key={item.id}>
              <FreeListRowHeading trailing={item.value}>{item.label}</FreeListRowHeading>
              <Text size="sm" tone="muted">{item.detail}</Text>
            </FreeListRow>
          ))}
        </FreeList>
      </FreeSection>

      <FreeSection>
        <Heading2>{free.enough.heading}</Heading2>
        <FreeSectionBody>{free.enough.body}</FreeSectionBody>
        <FreeList>
          {free.enough.setups.map((setup) => (
            <FreeListRow key={setup.id}>
              <FreeListRowHeading trailing={setup.usage} to={setup.href}>{setup.title}</FreeListRowHeading>
              <Text size="sm" tone="muted">{setup.body}</Text>
            </FreeListRow>
          ))}
        </FreeList>
      </FreeSection>

      <FreeSection>
        <Heading2>{free.setup.heading}</Heading2>
        <FreeList ordered>
          {free.setup.steps.map((step, index) => (
            <FreeListRow key={step.id}>
              <FreeListRowHeading>{`${index + 1}. ${step.title}`}</FreeListRowHeading>
              <Text size="sm" tone="muted">{step.body}</Text>
            </FreeListRow>
          ))}
        </FreeList>
      </FreeSection>

      <FreeSection>
        <Heading2>{free.pro.heading}</Heading2>
        <FreeSectionBody>
          {free.pro.body}{" "}
          <TextLink to="/pricing" size="sm" tone="default">{free.pro.linkLabel}</TextLink>.
        </FreeSectionBody>
        <FreeList>
          {free.pro.reasons.map((reason) => (
            <FreeListRow key={reason.id}>
              <FreeListRowHeading>{reason.title}</FreeListRowHeading>
              <Text size="sm" tone="muted">{reason.body}</Text>
            </FreeListRow>
          ))}
        </FreeList>
      </FreeSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">{free.faq.heading}</Heading2>
        <MarketingFaqList>
          {free.faq.items.map((item) => (
            <MarketingFaqItem key={item.question}>
              <Collapsible trigger={<MarketingFaqQuestion>{item.question}</MarketingFaqQuestion>}>
                <Text size="sm" tone="muted">{item.answer}</Text>
              </Collapsible>
            </MarketingFaqItem>
          ))}
        </MarketingFaqList>
      </MarketingFaqSection>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">{free.cta.heading}</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            {free.cta.body}
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="free"
            >
              <ButtonText>{free.cta.primaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowRightIcon size={16} />
              </ButtonIcon>
            </LinkButton>
            <LinkButton to="/pricing" size="compact" variant="inverse-ghost">
              <ButtonText>{free.cta.secondaryLabel}</ButtonText>
            </LinkButton>
          </div>
        </MarketingCtaCard>
      </MarketingCtaSection>
    </div>
  );
}
