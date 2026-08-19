import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import {
  MarketingPricingComparisonGrid,
  MarketingPricingComparisonSpacer,
  MarketingPricingFeatureDisplay,
  MarketingPricingFeatureLabel,
  MarketingPricingFeatureMatrix,
  MarketingPricingFeatureRow,
  MarketingPricingFeatureValue,
  MarketingPricingPlanCard,
  MarketingPricingSection,
} from "@/features/marketing/components/marketing-pricing-section";
import {
  MarketingFaqItem,
  MarketingFaqList,
  MarketingFaqQuestion,
  MarketingFaqSection,
} from "@/features/marketing/components/marketing-faq";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { PRICING_FEATURES, PRICING_PLANS, pricingPlanHighlights } from "@/features/marketing/pricing-plans";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail, offerCatalogSchema, faqSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const breadcrumbs = breadcrumbTrail({ name: "Pricing", path: "/pricing" });

const PAGE_DESCRIPTION =
  "Keeper.sh is free for 2 calendar accounts and 3 connections. Pro is $5 a month, or $45 a year, for unlimited calendars and Google and Outlook changes that land within seconds.";

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What counts as a calendar account?",
    answer: "An account is one connected calendar provider, such as a Google or Outlook login or a CalDAV server. Free allows 2, Pro is unlimited.",
  },
  {
    question: "What counts as a connection?",
    answer: "A connection copies events from one calendar into another. Free includes 3, Pro is unlimited. If you want two calendars to match each other, that is two connections.",
  },
  {
    question: "How quickly do changes show up?",
    answer: "On Pro, Google and Outlook tell Keeper.sh the moment an event changes, so it reaches your other calendars within seconds. On Free your calendars are checked every minute and changes are copied every 30. iCloud, Fastmail and other CalDAV calendars are checked on a timer on either plan, because Apple publishes no way for a calendar tool to be told an event changed.",
  },
  {
    question: "Is there a discount for paying annually?",
    answer: "Pro is $5 per month, or $45 per year if you pay annually (25% off $60).",
  },
  {
    question: "Is self-hosting free?",
    answer: "Yes. Every account on a self-hosted instance gets every paid sync feature, with no plan limits — Keeper.sh is open-source under AGPL-3.0. You are the one running the server, so updates, backups and downtime are yours to handle.",
  },
  {
    question: "Do I need a Google or Microsoft account to sign up?",
    answer: "No. On both plans you can create an account with an email address and password, and add a passkey afterwards. Google and Microsoft sign-in are optional, and connecting a calendar is separate from how you sign in.",
  },
  {
    question: "Can I cancel my subscription?",
    answer: "Billing is handled by Polar. You can manage or cancel your subscription from the customer portal linked in your account settings.",
  },
];

export const Route = createFileRoute("/(marketing)/pricing")({
  component: PricingPage,
  head: () => seoHead({
    title: "Pricing",
    description: PAGE_DESCRIPTION,
    path: "/pricing",
    scripts: [
      jsonLdScript(webPageSchema("Pricing", PAGE_DESCRIPTION, "/pricing")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(offerCatalogSchema("/pricing", PRICING_PLANS.map((plan) => ({
        name: plan.name,
        price: plan.price.replace("$", ""),
        description: plan.description,
      })))),
      jsonLdScript(faqSchema("/pricing", FAQ_ITEMS)),
    ],
  }),
});

function PricingPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>Pricing</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          Start free with two calendar accounts and three connections. Pro is $5 a month, or $45 a year, for as many
          calendars as you want.
        </Text>
      </header>

      <MarketingPricingSection>
        <MarketingPricingComparisonGrid>
          <MarketingPricingComparisonSpacer />

          {PRICING_PLANS.map((plan) => (
            <MarketingPricingPlanCard
              key={plan.id}
              tone={plan.tone}
              name={plan.name}
              price={plan.price}
              period={plan.period}
              description={plan.description}
              ctaLabel={plan.ctaLabel}
              features={pricingPlanHighlights(plan.id)}
            />
          ))}

          <MarketingPricingFeatureMatrix>
            {PRICING_FEATURES.map((feature) => (
              <MarketingPricingFeatureRow key={feature.label}>
                <MarketingPricingFeatureLabel>
                  <Text size="sm" className="text-left text-nowrap">{feature.label}</Text>
                </MarketingPricingFeatureLabel>
                <MarketingPricingFeatureValue>
                  <MarketingPricingFeatureDisplay value={feature.free} tone="muted" />
                </MarketingPricingFeatureValue>
                <MarketingPricingFeatureValue>
                  <MarketingPricingFeatureDisplay value={feature.pro} tone="muted" />
                </MarketingPricingFeatureValue>
              </MarketingPricingFeatureRow>
            ))}
          </MarketingPricingFeatureMatrix>
        </MarketingPricingComparisonGrid>
      </MarketingPricingSection>

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
    </div>
  );
}
