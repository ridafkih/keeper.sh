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
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "Self-Hosting", path: "/self-hosting" });

const README_URL = "https://github.com/ridafkih/keeper.sh#self-hosted";

const PAGE_DESCRIPTION =
  "Run Keeper.sh on your own server. It is open-source under AGPL-3.0, ships as Docker images, and every account on a self-hosted instance gets the Pro feature set with no plan limits.";

type SelfHostingCard = {
  title: string;
  body: string;
  gridClassName: string;
  illustration?: ReactNode;
};

const SELF_HOSTING_CARDS: SelfHostingCard[] = [
  {
    title: "Every Pro feature, with no plan limits",
    body: "A self-hosted instance runs without commercial mode, so every account on it gets the Pro feature set: unlimited linked accounts and sync mappings, changes written out to your calendars every minute, event filters, iCal feed customization, and uncapped API and MCP access.",
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-1",
    illustration: <MarketingIllustrationSync />,
  },
  {
    title: "The same calendars, on your own instance",
    body: "Google Calendar, Outlook, iCloud, Fastmail, and any CalDAV server work as a source or a destination, and iCal and ICS links can be pulled in. Google and Outlook need OAuth credentials you register yourself; the rest need nothing extra.",
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-1",
    illustration: <MarketingIllustrationProviders />,
  },
  {
    title: "Seven images, one of them recommended",
    body: "Start with keeper-standalone behind a reverse proxy. It carries the web, API, cron, worker, and MCP services along with PostgreSQL and Redis, so it is the path with the fewest moving parts. keeper-services leaves the database and Redis to you, and five more images run each service on its own.",
    gridClassName: "lg:col-start-1 lg:col-span-4 lg:row-start-2",
    illustration: <MarketingIllustrationSetup />,
  },
  {
    title: "Your calendar data sits on your hardware",
    body: "Events, sync mappings, and connected accounts live in a PostgreSQL database you run. CalDAV credentials are encrypted at rest with a key you generate, and your instance talks to the calendar providers you connect rather than to keeper.sh.",
    gridClassName: "lg:col-start-5 lg:col-span-6 lg:row-start-2",
  },
  {
    title: "Open-source under AGPL-3.0",
    body: "Keeper.sh is open-source, and the hosted version runs the same code you deploy. You can read what it does with your calendars instead of taking our word for it, and the project takes contributions.",
    gridClassName: "lg:col-start-1 lg:col-span-5 lg:row-start-3",
    illustration: <MarketingIllustrationContributors />,
  },
  {
    title: "What it costs you instead of the $5",
    body: "A server, a domain, upgrades, backups, your own Google and Microsoft OAuth apps, and being the person paged when it stops. The hosted version is the same engine with those parts taken care of, and paying for it funds the work on both.",
    gridClassName: "lg:col-start-6 lg:col-span-5 lg:row-start-3",
  },
];

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is self-hosting free?",
    answer: "Keeper.sh is open-source under AGPL-3.0. A self-hosted instance runs without commercial mode, so every account on it gets the Pro feature set and no plan limits.",
  },
  {
    question: "Which image should I start with?",
    answer: "keeper-standalone, behind a reverse proxy. It bundles the web, API, cron, worker, and MCP services with PostgreSQL and Redis, and auto-configures them internally. Use keeper-services if you would rather run the database and Redis yourself, or the individual service images if you want to place each one separately.",
  },
  {
    question: "Do I need Google and Microsoft OAuth apps?",
    answer: "Only for the Google Calendar and Outlook integrations, which need client credentials you register yourself. iCloud, Fastmail, CalDAV servers, and iCal or ICS links need nothing beyond the instance itself.",
  },
  {
    question: "How do updates work?",
    answer: "Updates ship as Docker images. Pin yours to a major.minor tag such as 2.13 rather than latest, so a breaking change does not arrive with the next pull.",
  },
  {
    question: "Where do my credentials and events live?",
    answer: "In the PostgreSQL database your instance uses. CalDAV credentials are encrypted at rest with the encryption key you generate when you set the instance up.",
  },
];

export const Route = createFileRoute("/(marketing)/self-hosting")({
  component: SelfHostingPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/self-hosting") }],
    meta: seoMeta({
      title: "Self-Hosted Calendar Sync",
      description: PAGE_DESCRIPTION,
      path: "/self-hosting",
    }),
    scripts: [
      jsonLdScript(webPageSchema("Self-Hosting", PAGE_DESCRIPTION, "/self-hosting")),
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
        <Heading1>Self-hosted calendar sync</Heading1>
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
        <Heading2>Getting it running</Heading2>
        <Text size="sm" tone="muted" className="mt-2 mb-8 max-w-[64ch]">
          The README carries the compose files, the environment variable table, and the OAuth setup for Google and Microsoft.
        </Text>
        <MarketingFeatureBentoGrid>
          <MarketingFeatureBentoCard className="lg:col-start-1 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">What you need</Heading3>
              <Text size="sm" className="text-left">
                Docker and Docker Compose, a machine to run them on, and a domain if you want the instance reachable from
                outside your network.
              </Text>
              <Text size="sm" tone="muted" className="text-left">
                Google Calendar and Outlook additionally need OAuth apps registered under your own Google Cloud and Azure
                accounts.
              </Text>
            </MarketingFeatureBentoBody>
          </MarketingFeatureBentoCard>

          <MarketingFeatureBentoCard className="lg:col-start-6 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">The short version</Heading3>
              <Text size="sm" className="text-left">
                Pull keeper-standalone, generate the auth secret and encryption key it asks for, point it at the URL you
                will serve it on, and put it behind a reverse proxy that terminates TLS.
              </Text>
              <ExternalTextLink align="left" href={README_URL} rel="noreferrer" size="sm" target="_blank" tone="muted">
                Read the self-hosting guide
              </ExternalTextLink>
            </MarketingFeatureBentoBody>
          </MarketingFeatureBentoCard>
        </MarketingFeatureBentoGrid>
      </MarketingFeatureBentoSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">Frequently Asked Questions</Heading2>
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
          <Heading2 className="text-center text-white">Ready to run it yourself?</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            The setup guide covers every image and every environment variable. Or skip the server and use the hosted
            version.
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <ExternalLinkButton
              href={README_URL}
              target="_blank"
              rel="noreferrer"
              size="compact"
              variant="inverse"
            >
              <ButtonText>Read the Setup Guide</ButtonText>
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
              <ButtonText>Use the Hosted Version</ButtonText>
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
