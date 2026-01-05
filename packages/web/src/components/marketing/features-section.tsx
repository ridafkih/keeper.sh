import type { FC } from "react";
import { Calendar, EyeOff, Link2, Server, Upload } from "lucide-react";
import { MarketingSection } from "./marketing-section";
import { FeatureCard } from "./feature-card";
import type { Feature } from "./feature-card";

const features: Feature[] = [
  {
    description: "Combine events from multiple calendar sources into a single unified feed.",
    icon: Calendar,
    title: "Aggregate Calendars",
  },
  {
    description:
      "Event details are stripped, showing only busy/free times to protect your privacy.",
    icon: EyeOff,
    title: "Anonymized Events",
  },
  {
    description: "Generate a shareable iCal link that stays in sync with your sources.",
    icon: Link2,
    title: "iCal Feed Export",
  },
  {
    description: "Automatically push aggregated events to Google Calendar and others.",
    icon: Upload,
    title: "Push to Calendars",
  },
  {
    description: "Run it on your own infrastructure. Fully open-source and GPL-3.0 licensed.",
    icon: Server,
    title: "Self-Hostable",
  },
];

interface FeaturesSectionProps {
  showHeading?: boolean;
}

const getHeading = (showHeading: boolean): string | undefined => {
  if (showHeading) {
    return "Features";
  }
  return undefined;
};

export const FeaturesSection: FC<FeaturesSectionProps> = ({ showHeading = true }) => {
  const heading = getHeading(showHeading);
  return (
    <MarketingSection id="features" heading={heading}>
      <div className="flex flex-col gap-2">
        {features.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </div>
    </MarketingSection>
  );
};
