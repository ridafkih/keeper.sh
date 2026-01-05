import type { ReactNode } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { PricingSection } from "@/components/marketing/pricing-section";
import { isCommercialMode } from "@/config/mode";

export const metadata: Metadata = {
  description:
    "Simple pricing for individuals and teams. Free plan with basic features, Pro plan for unlimited calendars and faster sync.",
  title: "Pricing",
};

export default function PricingPage(): ReactNode {
  if (!isCommercialMode) {
    redirect("/dashboard");
  }

  return (
    <MarketingPage title="Pricing" description="Simple pricing for individuals and teams.">
      <PricingSection showHeading={false} />
    </MarketingPage>
  );
}
