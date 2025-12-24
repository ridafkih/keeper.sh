import { MarketingPage } from "@/components/marketing/marketing-page";
import { PricingSection } from "@/components/marketing/pricing-section";

export default function PricingPage() {
  return (
    <MarketingPage
      title="Pricing"
      description="Simple pricing for individuals and teams."
    >
      <PricingSection showHeading={false} />
    </MarketingPage>
  );
}
