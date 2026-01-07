import type { FC, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { TextBody } from "@/components/typography";

const emptyState = tv({
  base: "flex flex-col items-center gap-2 py-6 border border-dashed border-border-input rounded-md",
});

interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
  className?: string;
}

export const EmptyState: FC<EmptyStateProps> = ({ icon, message, action, className }) => (
  <div className={emptyState({ className })}>
    {icon}
    <TextBody className="text-center max-w-[36ch]">{message}</TextBody>
    {action}
  </div>
);
