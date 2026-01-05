import type { ReactNode } from "react";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { FeaturesSection } from "@/components/marketing/features-section";

export const metadata: Metadata = {
  description:
    "Everything you need to keep your calendars in sync. Aggregate calendars, anonymize events, export iCal feeds, and push to Google Calendar.",
  title: "Features",
};

export default function FeaturesPage(): ReactNode {
  return (
    <MarketingPage
      title="Features"
      description="Everything you need to keep your calendars in sync."
    >
      <FeaturesSection showHeading={false} />
    </MarketingPage>
  );
}
