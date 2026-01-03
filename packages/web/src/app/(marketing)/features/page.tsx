import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { FeaturesSection } from "@/components/marketing/features-section";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything you need to keep your calendars in sync. Aggregate calendars, anonymize events, export iCal feeds, and push to Google Calendar.",
};

export default function FeaturesPage() {
  return (
    <MarketingPage
      title="Features"
      description="Everything you need to keep your calendars in sync."
    >
      <FeaturesSection showHeading={false} />
    </MarketingPage>
  );
}
