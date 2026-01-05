import type { FC } from "react";
import { Calendar, EyeOff, Link2, Server, Upload } from "lucide-react";
import { MarketingSection } from "./marketing-section";
import { FeatureCard, type Feature } from "./feature-card";

const features: Feature[] = [
  {
    icon: Calendar,
    title: "Aggregate Calendars",
    description: "Combine events from multiple calendar sources into a single unified feed.",
  },
  {
    icon: EyeOff,
    title: "Anonymized Events",
    description:
      "Event details are stripped, showing only busy/free times to protect your privacy.",
  },
  {
    icon: Link2,
    title: "iCal Feed Export",
    description: "Generate a shareable iCal link that stays in sync with your sources.",
  },
  {
    icon: Upload,
    title: "Push to Calendars",
    description: "Automatically push aggregated events to Google Calendar and others.",
  },
  {
    icon: Server,
    title: "Self-Hostable",
    description: "Run it on your own infrastructure. Fully open-source and GPL-3.0 licensed.",
  },
];

interface FeaturesSectionProps {
  showHeading?: boolean;
}

export const FeaturesSection: FC<FeaturesSectionProps> = ({ showHeading = true }) => (
  <MarketingSection id="features" heading={showHeading ? "Features" : undefined}>
    <div className="flex flex-col gap-2">
      {features.map((feature) => (
        <FeatureCard key={feature.title} feature={feature} />
      ))}
    </div>
  </MarketingSection>
);
