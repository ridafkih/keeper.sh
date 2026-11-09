import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from "@/components/ui/primitives/button";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from "@/features/marketing/components/marketing-feature-bento";
import {
  MarketingFaqItem,
  MarketingFaqList,
  MarketingFaqQuestion,
  MarketingFaqSection,
} from "@/features/marketing/components/marketing-faq";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { MarketingIllustrationContributors } from "@/illustrations/marketing-illustration-contributors";
import { MarketingIllustrationProviders } from "@/illustrations/marketing-illustration-providers";
import { MarketingIllustrationSetup } from "@/illustrations/marketing-illustration-setup";
import { MarketingIllustrationSync } from "@/illustrations/marketing-illustration-sync";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema, breadcrumbTrail, faqSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { marketingCopy } from "@/lib/marketing-copy";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "Self-Hosting", path: "/self-hosting" });

const README_URL = "https://github.com/ridafkih/keeper.sh#self-hosted";

const selfHosting = marketingCopy.selfHosting;
const PAGE_DESCRIPTION = selfHosting.seo.description;

type SelfHostingCard = {
  title: string;
  body: string;
  gridClassName: string;
  illustration?: ReactNode;
};

const CARD_PRESENTATION: Record<string, { gridClassName: string; illustration?: ReactNode }> = {
  features: {
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-1",
    illustration: <MarketingIllustrationSync />,
  },
  providers: {
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-1",
    illustration: <MarketingIllustrationProviders />,
  },
  container: {
    gridClassName: "lg:col-start-1 lg:col-span-4 lg:row-start-2",
    illustration: <MarketingIllustrationSetup />,
  },
  data: {
    gridClassName: "lg:col-start-5 lg:col-span-6 lg:row-start-2",
  },
  openSource: {
    gridClassName: "lg:col-start-1 lg:col-span-10 lg:row-start-3",
    illustration: <MarketingIllustrationContributors />,
  },
};

const SELF_HOSTING_CARDS: SelfHostingCard[] = selfHosting.cards.map((card) => {
  const presentation = CARD_PRESENTATION[card.id];

  if (!presentation) {
    throw new Error(`Self-hosting card "${card.id}" has no presentation.`);
  }

  return { title: card.title, body: card.body, ...presentation };
});

const FAQ_ITEMS = selfHosting.faq.items;

export const Route = createFileRoute("/(marketing)/self-hosting")({
  component: SelfHostingPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/self-hosting") }],
    meta: seoMeta({
      title: selfHosting.seo.title,
      description: PAGE_DESCRIPTION,
      path: "/self-hosting",
    }),
    scripts: [
      jsonLdScript(webPageSchema(selfHosting.seo.title, PAGE_DESCRIPTION, "/self-hosting")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(faqSchema("/self-hosting", FAQ_ITEMS)),
    ],
  }),
});

function SelfHostingPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{selfHosting.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <MarketingFeatureBentoSection>
        <MarketingFeatureBentoGrid>
          {SELF_HOSTING_CARDS.map((card) => (
            <MarketingFeatureBentoCard key={card.title} className={card.gridClassName}>
              <MarketingFeatureBentoIllustration plain={!!card.illustration}>
                {card.illustration}
              </MarketingFeatureBentoIllustration>
              <MarketingFeatureBentoBody>
                <Heading3 as="h2">{card.title}</Heading3>
                <Text size="sm" className="text-left">{card.body}</Text>
              </MarketingFeatureBentoBody>
            </MarketingFeatureBentoCard>
          ))}
        </MarketingFeatureBentoGrid>
      </MarketingFeatureBentoSection>

      <MarketingFeatureBentoSection>
        <Heading2>{selfHosting.setup.heading}</Heading2>
        <Text size="sm" tone="muted" className="mt-2 mb-8 max-w-[64ch]">
          {selfHosting.setup.subheading}
        </Text>
        <MarketingFeatureBentoGrid>
          <MarketingFeatureBentoCard className="lg:col-start-1 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">{selfHosting.setup.need.title}</Heading3>
              <Text size="sm" className="text-left">
                {selfHosting.setup.need.body}
              </Text>
              <Text size="sm" tone="muted" className="text-left">
                {selfHosting.setup.need.note}
              </Text>
            </MarketingFeatureBentoBody>
          </MarketingFeatureBentoCard>

          <MarketingFeatureBentoCard className="lg:col-start-6 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">{selfHosting.setup.do.title}</Heading3>
              <Text size="sm" className="text-left">
                {selfHosting.setup.do.body}
              </Text>
              <ExternalTextLink align="left" href={README_URL} rel="noreferrer" size="sm" target="_blank" tone="muted">
                {selfHosting.setup.do.linkLabel}
              </ExternalTextLink>
            </MarketingFeatureBentoBody>
          </MarketingFeatureBentoCard>
        </MarketingFeatureBentoGrid>
      </MarketingFeatureBentoSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">{selfHosting.faq.heading}</Heading2>
        <MarketingFaqList>
          {FAQ_ITEMS.map((item) => (
            <MarketingFaqItem key={item.question}>
              <Collapsible
                trigger={<MarketingFaqQuestion>{item.question}</MarketingFaqQuestion>}
              >
                <Text size="sm" tone="muted">{item.answer}</Text>
              </Collapsible>
            </MarketingFaqItem>
          ))}
        </MarketingFaqList>
      </MarketingFaqSection>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">{selfHosting.cta.heading}</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            {selfHosting.cta.body}
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <ExternalLinkButton
              href={README_URL}
              target="_blank"
              rel="noreferrer"
              size="compact"
              variant="inverse"
            >
              <ButtonText>{selfHosting.cta.primaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowUpRightIcon size={16} />
              </ButtonIcon>
            </ExternalLinkButton>
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse-ghost"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="self-hosting"
            >
              <ButtonText>{selfHosting.cta.secondaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowRightIcon size={16} />
              </ButtonIcon>
            </LinkButton>
          </div>
        </MarketingCtaCard>
      </MarketingCtaSection>
    </div>
  );
}
