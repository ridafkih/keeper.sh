import type { ReactNode } from "react";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";

interface OnboardingHeadingProps {
  title: ReactNode;
  description: ReactNode;
}

export function OnboardingHeading({ title, description }: OnboardingHeadingProps) {
  return (
    <div className="flex flex-col gap-1 px-0.5 pb-1.5">
      <Heading2 as="h1">{title}</Heading2>
      <Text size="sm" tone="muted">{description}</Text>
    </div>
  );
}
