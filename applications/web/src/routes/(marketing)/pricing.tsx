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
import { marketingCopy } from "@/lib/marketing-copy";

const breadcrumbs = breadcrumbTrail({ name: "Pricing", path: "/pricing" });

const pricing = marketingCopy.pricing;
const PAGE_DESCRIPTION = pricing.seo.description;

const FAQ_ITEMS = pricing.faq.items;

export const Route = createFileRoute("/(marketing)/pricing")({
  component: PricingPage,
  head: () => seoHead({
    title: pricing.seo.title,
    description: PAGE_DESCRIPTION,
    path: "/pricing",
    scripts: [
      jsonLdScript(webPageSchema(pricing.seo.title, PAGE_DESCRIPTION, "/pricing")),
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
        <Heading1>{pricing.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {pricing.header.body}
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
              headingLevel="h2"
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
        <Heading2 className="text-center">{pricing.faq.heading}</Heading2>
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
