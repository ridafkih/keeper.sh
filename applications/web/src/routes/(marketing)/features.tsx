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
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "Features", path: "/features" });

const PAGE_DESCRIPTION =
  "Keeper.sh copies your events between calendars, so every one of them shows you as busy at the same times. Works with Google Calendar, Outlook, iCloud, Fastmail and more.";

type FeatureCard = {
  title: string;
  body: string;
  gridClassName: string;
  illustration?: ReactNode;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: "Works with the calendars you already use",
    body: "Google, Outlook, iCloud and Fastmail sign in directly. Anything else connects with a link you paste in, or over CalDAV.",
    gridClassName: "lg:col-start-1 lg:col-span-4 lg:row-start-1",
    illustration: <MarketingIllustrationProviders />,
  },
  {
    title: "See your whole week in one place",
    body: "Every calendar you connect also lands in a single link. Subscribe to it from any calendar app.",
    gridClassName: "lg:col-start-5 lg:col-span-6 lg:row-start-1",
    illustration: <MarketingIllustrationSync />,
  },
  {
    title: "Keep your event details off the link you share",
    body: "Every event on the link reads “Busy”, with no title, description or location. On Pro you choose which details it keeps.",
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-2",
  },
  {
    title: "Pick which calendar your events land in",
    body: "You choose where each calendar's events are copied to. Copying runs one way, so set up both directions if you want the two to match.",
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-2",
    illustration: <MarketingIllustrationSetup />,
  },
  {
    title: "Move an event and the copy moves too",
    body: "Delete it and the copy goes with it. Your other calendar gets corrected instead of collecting duplicates.",
    gridClassName: "lg:col-start-1 lg:col-span-5 lg:row-start-3",
  },
  {
    title: "Anyone can read the code",
    body: "Check exactly what Keeper.sh sends to your calendars, or run it on your own server. It is open source under AGPL-3.0, with Docker images ready to deploy.",
    gridClassName: "lg:col-start-6 lg:col-span-5 lg:row-start-3",
    illustration: <MarketingIllustrationContributors />,
  },
  {
    title: "Let AI agents view and manage your calendar",
    body: "Connect Claude, Cursor or any MCP client and let it check your week, book events and reschedule. Revoke it whenever you like.",
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-4",
  },
  {
    title: "Build your own tools on top",
    body: "A REST API under /api/v1, with a token you create under Settings → API Tokens. Free allows 25 calls a day; Pro is uncapped.",
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-4",
  },
];


export const Route = createFileRoute("/(marketing)/features")({
  component: FeaturesPage,
  head: () => seoHead({
    title: "Calendar Sync Features",
    description: PAGE_DESCRIPTION,
    path: "/features",
    scripts: [
      jsonLdScript(webPageSchema("Calendar Sync Features", PAGE_DESCRIPTION, "/features")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function FeaturesPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>What Keeper.sh does for your calendars</Heading1>
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
        <Heading2>How your calendars stay in step</Heading2>
        <Text size="sm" tone="muted" className="mt-2 max-w-[64ch]">
          You set this up once. After that, Keeper.sh keeps every copy up to date.
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
          <Heading2 className="text-center text-white">Ready to sync your calendars?</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            Free for two calendar accounts. No credit card.
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="features"
            >
              <ButtonText>Get Started</ButtonText>
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
              <ButtonText>View on GitHub</ButtonText>
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
