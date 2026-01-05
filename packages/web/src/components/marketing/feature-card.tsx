import type { FC } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/card";
import { IconBox } from "@/components/icon-box";
import { CardTitle, TextBody } from "@/components/typography";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface FeatureCardProps {
  feature: Feature;
}

const FeatureCard: FC<FeatureCardProps> = ({ feature }) => (
  <Card padding="sm" className="flex gap-3">
    <IconBox size="lg" variant="muted">
      <feature.icon className="size-5 text-foreground-muted" />
    </IconBox>
    <div className="flex flex-col gap-1">
      <CardTitle>{feature.title}</CardTitle>
      <TextBody>{feature.description}</TextBody>
    </div>
  </Card>
);

export { FeatureCard };
export type { Feature };
