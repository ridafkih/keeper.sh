import { MarketingPage } from "@/components/marketing/marketing-page";
import { HeroSection } from "@/components/marketing/hero-section";
import { FeaturesSection } from "@/components/marketing/features-section";
import { PricingSection } from "@/components/marketing/pricing-section";

export default function HomePage() {
  return (
    <MarketingPage>
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
    </MarketingPage>
  );
}
