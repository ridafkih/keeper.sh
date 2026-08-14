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
import { PRICING_FEATURES, PRICING_PLANS } from "@/features/marketing/pricing-plans";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema, breadcrumbTrail, offerCatalogSchema, faqSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const breadcrumbs = breadcrumbTrail({ name: "Pricing", path: "/pricing" });

const PAGE_DESCRIPTION =
  "Keeper.sh pricing. Free covers 2 linked accounts, 3 sync mappings, and changes reaching your other calendars every 30 minutes. Pro is $5 per month for unlimited accounts and mappings, changes every minute, and uncapped API access.";

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What counts as a linked account?",
    answer: "An account is one connected calendar provider, such as a Google or Outlook login or a CalDAV server. Free allows 2, Pro is unlimited.",
  },
  {
    question: "What counts as a sync mapping?",
    answer: "A mapping is one source calendar pushed to one destination calendar. Free allows 3, Pro is unlimited.",
  },
  {
    question: "How quickly do changes show up?",
    answer: "Changes are picked up from your calendars every minute on both plans. On Free they reach your other calendars every 30 minutes, and on Pro every minute.",
  },
  {
    question: "Is there a discount for paying annually?",
    answer: "Pro is $5 per month, or $42 per year if you pay annually.",
  },
  {
    question: "Is self-hosting free?",
    answer: "Keeper.sh is open-source under AGPL-3.0. A self-hosted instance runs without commercial mode, so every account on it gets the Pro feature set and no plan limits.",
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
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/pricing") }],
    meta: seoMeta({
      title: "Pricing",
      description: PAGE_DESCRIPTION,
      path: "/pricing",
    }),
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
          Keeper.sh uses a low-cost freemium model to give you a solid range of choice. Self-hosting is free and
          includes every Pro feature.
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
