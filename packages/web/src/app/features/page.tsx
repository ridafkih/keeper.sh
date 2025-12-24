import { MarketingPage } from "@/components/marketing/marketing-page";
import { FeaturesSection } from "@/components/marketing/features-section";

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
