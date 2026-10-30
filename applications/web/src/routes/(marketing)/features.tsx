import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from "@/components/ui/primitives/button";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from "@/features/marketing/components/marketing-feature-bento";
import {
  MarketingHowItWorksCard,
  MarketingHowItWorksRow,
  MarketingHowItWorksSection,
  MarketingHowItWorksStepBody,
  MarketingHowItWorksStepIllustration,
} from "@/features/marketing/components/marketing-how-it-works";
import { MarketingIllustrationContributors } from "@/illustrations/marketing-illustration-contributors";
import { MarketingIllustrationProviders } from "@/illustrations/marketing-illustration-providers";
import { MarketingIllustrationSetup } from "@/illustrations/marketing-illustration-setup";
import { MarketingIllustrationSync } from "@/illustrations/marketing-illustration-sync";
import { HowItWorksConnect } from "@/illustrations/how-it-works-connect";
import { HowItWorksConfigure } from "@/illustrations/how-it-works-configure";
import { HowItWorksSync } from "@/illustrations/how-it-works-sync";
import { HOW_IT_WORKS_STEPS } from "@/features/marketing/how-it-works-steps";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { marketingCopy } from "@/lib/marketing-copy";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "Features", path: "/features" });

const features = marketingCopy.features;
const PAGE_DESCRIPTION = features.seo.description;

type FeatureCard = {
  title: string;
  body: string;
  gridClassName: string;
  illustration?: ReactNode;
};

const CARD_PRESENTATION: Record<string, { gridClassName: string; illustration?: ReactNode }> = {
  providers: {
    gridClassName: "lg:col-start-1 lg:col-span-4 lg:row-start-1",
    illustration: <MarketingIllustrationProviders />,
  },
  link: {
    gridClassName: "lg:col-start-5 lg:col-span-6 lg:row-start-1",
    illustration: <MarketingIllustrationSync />,
  },
  privacy: {
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-2",
  },
  direction: {
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-2",
    illustration: <MarketingIllustrationSetup />,
  },
  moves: {
    gridClassName: "lg:col-start-1 lg:col-span-5 lg:row-start-3",
  },
  openSource: {
    gridClassName: "lg:col-start-6 lg:col-span-5 lg:row-start-3",
    illustration: <MarketingIllustrationContributors />,
  },
  agents: {
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-4",
  },
  api: {
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-4",
  },
};

const FEATURE_CARDS: FeatureCard[] = features.cards.map((card) => {
  const presentation = CARD_PRESENTATION[card.id];

  if (!presentation) {
    throw new Error(`Feature card "${card.id}" has no presentation.`);
  }

  return { title: card.title, body: card.body, ...presentation };
});


export const Route = createFileRoute("/(marketing)/features")({
  component: FeaturesPage,
  head: () => seoHead({
    title: features.seo.title,
    description: PAGE_DESCRIPTION,
    path: "/features",
    scripts: [
      jsonLdScript(webPageSchema(features.seo.title, PAGE_DESCRIPTION, "/features")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function FeaturesPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{features.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <MarketingFeatureBentoSection>
        <MarketingFeatureBentoGrid>
          {FEATURE_CARDS.map((card) => (
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

      <MarketingHowItWorksSection>
        <Heading2>{features.howItWorks.heading}</Heading2>
        <Text size="sm" tone="muted" className="mt-2 max-w-[64ch]">
          {features.howItWorks.subheading}
        </Text>
        <MarketingHowItWorksCard>
          <MarketingHowItWorksRow>
            <MarketingHowItWorksStepBody step={1}>
              <Heading3 as="h3">{HOW_IT_WORKS_STEPS[0].title}</Heading3>
              <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[0].body}</Text>
            </MarketingHowItWorksStepBody>
            <MarketingHowItWorksStepIllustration align="right">
              <HowItWorksConnect />
            </MarketingHowItWorksStepIllustration>
          </MarketingHowItWorksRow>

          <MarketingHowItWorksRow reverse>
            <MarketingHowItWorksStepBody step={2}>
              <Heading3 as="h3">{HOW_IT_WORKS_STEPS[1].title}</Heading3>
              <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[1].body}</Text>
            </MarketingHowItWorksStepBody>
            <MarketingHowItWorksStepIllustration align="left">
              <HowItWorksConfigure />
            </MarketingHowItWorksStepIllustration>
          </MarketingHowItWorksRow>

          <MarketingHowItWorksRow>
            <MarketingHowItWorksStepBody step={3}>
              <Heading3 as="h3">{HOW_IT_WORKS_STEPS[2].title}</Heading3>
              <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[2].body}</Text>
              <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[2].note}</Text>
            </MarketingHowItWorksStepBody>
            <MarketingHowItWorksStepIllustration align="right">
              <HowItWorksSync />
            </MarketingHowItWorksStepIllustration>
          </MarketingHowItWorksRow>
        </MarketingHowItWorksCard>
      </MarketingHowItWorksSection>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">{features.cta.heading}</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            {features.cta.body}
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="features"
            >
              <ButtonText>{features.cta.primaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowRightIcon size={16} />
              </ButtonIcon>
            </LinkButton>
            <ExternalLinkButton
              href="https://github.com/ridafkih/keeper.sh"
              target="_blank"
              rel="noreferrer"
              size="compact"
              variant="inverse-ghost"
            >
              <ButtonText>{features.cta.secondaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowUpRightIcon size={16} />
              </ButtonIcon>
            </ExternalLinkButton>
          </div>
        </MarketingCtaCard>
      </MarketingCtaSection>
    </div>
  );
}
