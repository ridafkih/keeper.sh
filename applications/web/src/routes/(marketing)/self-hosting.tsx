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
  "Run Keeper.sh on your own hardware and stop your calendars double-booking. Every account on your own instance gets every paid sync feature, with no plan limits.";

type SelfHostingCard = {
  title: string;
  body: string;
  gridClassName: string;
  illustration?: ReactNode;
};

const SELF_HOSTING_CARDS: SelfHostingCard[] = [
  {
    title: "Every paid sync feature, with no plan limits",
    body: "Every account on your own instance gets every paid feature: unlimited accounts and connections, updates every minute, event filters, and uncapped API and MCP calls.",
    gridClassName: "lg:col-start-1 lg:col-span-6 lg:row-start-1",
    illustration: <MarketingIllustrationSync />,
  },
  {
    title: "Works with the same calendars as the hosted version",
    body: "Google Calendar, Outlook, iCloud, Fastmail and any CalDAV server all work. You can also paste a calendar link and copy events out of it. Google and Outlook need OAuth apps you register yourself.",
    gridClassName: "lg:col-start-7 lg:col-span-4 lg:row-start-1",
    illustration: <MarketingIllustrationProviders />,
  },
  {
    title: "Get it running with a single container",
    body: "The keeper-standalone image bundles the web, API, cron, worker and MCP services with PostgreSQL and Redis. Six other images let you split those out if you want to place each part yourself.",
    gridClassName: "lg:col-start-1 lg:col-span-4 lg:row-start-2",
    illustration: <MarketingIllustrationSetup />,
  },
  {
    title: "Your calendar data sits on your hardware",
    body: "Your events, your connections and your linked accounts live in a PostgreSQL database you run. CalDAV passwords are encrypted with a key you generate. Your instance talks straight to your calendar providers, with nothing going through keeper.sh.",
    gridClassName: "lg:col-start-5 lg:col-span-6 lg:row-start-2",
  },
  {
    title: "Anyone can read the code",
    body: "The hosted version runs the same code you deploy, so you can check what it does with your calendars. Keeper.sh is open source under AGPL-3.0 and takes contributions.",
    gridClassName: "lg:col-start-1 lg:col-span-10 lg:row-start-3",
    illustration: <MarketingIllustrationContributors />,
  },
];

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What does running it myself cost?",
    answer: "There is no licence fee, and every account on your instance gets every paid sync feature. You pay instead in a server, a domain, upgrades, backups, and being the person paged when it breaks. Hosted Keeper.sh is $5 a month with all of that handled.",
  },
  {
    question: "Which image should I start with?",
    answer: "keeper-standalone, behind a reverse proxy. It bundles the web, API, cron, worker and MCP services with PostgreSQL and Redis, and wires them together for you. Use the other images if you want to place each part yourself.",
  },
  {
    question: "Do I need Google and Microsoft OAuth apps?",
    answer: "Only for Google Calendar and Outlook. Those two need client credentials you register yourself. iCloud, Fastmail, CalDAV servers and calendar links need nothing extra.",
  },
  {
    question: "How do updates work?",
    answer: "Updates ship as Docker images. Pin yours to a major.minor tag such as 2.13. Pinning to latest can hand you a breaking change the next time you upgrade.",
  },
  {
    question: "Where do my credentials and events live?",
    answer: "In the PostgreSQL database your instance uses. CalDAV passwords are encrypted with the key you generate when you set the instance up.",
  },
];

export const Route = createFileRoute("/(marketing)/self-hosting")({
  component: SelfHostingPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/self-hosting") }],
    meta: seoMeta({
      title: "Run Keeper.sh on Your Own Server",
      description: PAGE_DESCRIPTION,
      path: "/self-hosting",
    }),
    scripts: [
      jsonLdScript(webPageSchema("Run Keeper.sh on Your Own Server", PAGE_DESCRIPTION, "/self-hosting")),
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
        <Heading1>Run Keeper.sh on your own server</Heading1>
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
          The README has the compose files, the environment variables, and the OAuth setup for Google and Microsoft.
        </Text>
        <MarketingFeatureBentoGrid>
          <MarketingFeatureBentoCard className="lg:col-start-1 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">What you need</Heading3>
              <Text size="sm" className="text-left">
                Docker and Docker Compose, a machine to run them on, and a domain if you want to reach the instance from
                outside your network.
              </Text>
              <Text size="sm" tone="muted" className="text-left">
                Google Calendar and Outlook also need OAuth apps registered under your own Google Cloud and Azure
                accounts.
              </Text>
            </MarketingFeatureBentoBody>
          </MarketingFeatureBentoCard>

          <MarketingFeatureBentoCard className="lg:col-start-6 lg:col-span-5 lg:row-start-1">
            <MarketingFeatureBentoBody>
              <Heading3 as="h3">What you do</Heading3>
              <Text size="sm" className="text-left">
                Download the keeper-standalone image and generate the two secrets it asks for. Set TRUSTED_ORIGINS to the
                URL you will serve it on, and put it behind a reverse proxy that handles TLS.
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
