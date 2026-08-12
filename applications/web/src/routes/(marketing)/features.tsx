import type { PropsWithChildren } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from "@/components/ui/primitives/button";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema } from "@/lib/seo";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const PAGE_DESCRIPTION =
  "Keeper copies events from one calendar into another and combines everything you connect into a single feed. Works with Google Calendar, Outlook, iCloud, Fastmail, and more.";

type FeatureSection = {
  title: string;
  body: string[];
  points?: string[];
};

const FEATURE_SECTIONS: FeatureSection[] = [
  {
    title: "Syncing that reconciles instead of duplicating",
    body: [
      "Events are pulled from every source you connect, then pushed to every destination you map them to. Updates and deletions propagate, so destination calendars are corrected rather than accumulating copies.",
      "Google and Outlook are pulled incrementally: Keeper stores a sync token or delta link per account and asks the provider only for what changed. CalDAV and ICS sources are re-read on each pass.",
    ],
    points: [
      "Both plans: changes are picked up from your calendars every minute",
      "Free plan: those changes reach your other calendars every 30 minutes",
      "Pro plan: those changes reach your other calendars every minute",
    ],
  },
  {
    title: "One aggregated iCal feed",
    body: [
      "Every source you connect is combined into a single iCal feed you can subscribe to from any calendar app. By default the feed is anonymized: titles, descriptions, and locations are stripped and every event reads as “Busy”, so you can share availability without sharing your schedule.",
      "On Pro you can customize the feed, choosing which details are included and what the placeholder title says.",
    ],
  },
  {
    title: "Control over what gets synced",
    body: [
      "Display settings are configured per destination calendar, so a work calendar can carry the title, description, and location while a shared one shows a generic block.",
      "Pro adds event filters and exclusions for skipping events you do not want mirrored at all.",
    ],
  },
  {
    title: "REST API",
    body: [
      "Keeper exposes a REST API under /api/v1, authenticated with a bearer token you create under Settings → API Tokens. It covers accounts, calendars, events, invites, and the iCal feed.",
      "The free plan allows 25 API calls per day. Pro is uncapped.",
    ],
  },
  {
    title: "MCP server",
    body: [
      "Keeper ships an MCP server so an assistant can read and write your calendars directly, authenticated with OAuth 2.1 and a consent screen you approve in the browser.",
    ],
    points: [
      "Read: list_calendars, list_accounts, get_events, get_event, get_event_count, get_pending_invites, get_ical_feed",
      "Write: create_event, update_event, delete_event, rsvp_event",
    ],
  },
  {
    title: "Self-hosting",
    body: [
      "Keeper is open-source under the AGPL-3.0 license and publishes Docker images. A self-hosted instance runs with commercial mode off, which means every account on it gets the Pro feature set and no plan limits.",
    ],
  },
];

export const Route = createFileRoute("/(marketing)/features")({
  component: FeaturesPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/features") }],
    meta: seoMeta({
      title: "Features",
      description: PAGE_DESCRIPTION,
      path: "/features",
    }),
    scripts: [
      jsonLdScript(webPageSchema("Features", PAGE_DESCRIPTION, "/features")),
      jsonLdScript(breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Features", path: "/features" }])),
    ],
  }),
});

function FeaturesPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <header className="flex flex-col gap-1.5">
        <Heading1>Features</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <div className="flex flex-col gap-8">
        {FEATURE_SECTIONS.map((section) => (
          <Section key={section.title} title={section.title}>
            {section.body.map((paragraph) => (
              <Text key={paragraph} size="sm">{paragraph}</Text>
            ))}
            {section.points && (
              <ul className="list-disc list-inside flex flex-col gap-1 ml-2 text-sm tracking-tight text-foreground-muted">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </Section>
        ))}
      </div>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">Ready to sync your calendars?</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            Start syncing your calendars in seconds. Free to use, no credit card required.
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

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="flex flex-col gap-3">
      <Heading2 as="h2">{title}</Heading2>
      {children}
    </section>
  );
}
