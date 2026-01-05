import type { FC } from "react";
import { SubsectionTitle, TextBody } from "@/components/typography";

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const SectionHeader: FC<SectionHeaderProps> = ({ title, description, action }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <SubsectionTitle>{title}</SubsectionTitle>
      {description && <TextBody>{description}</TextBody>}
    </div>
    {action}
  </div>
);
