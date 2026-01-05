import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { HeroSection } from "@/components/marketing/hero-section";
import { FeaturesSection } from "@/components/marketing/features-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { isCommercialMode } from "@/config/mode";

export default function HomePage(): ReactNode {
  if (!isCommercialMode) {
    redirect("/dashboard");
  }

  return (
    <MarketingPage>
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
    </MarketingPage>
  );
}
