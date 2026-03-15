import type { PropsWithChildren, ReactNode } from "react";
import { tv } from "tailwind-variants/lite";
import { Text } from "./text";

const dashboardHeading = tv({
  base: "font-sans font-medium leading-tight tracking-tight text-foreground overflow-hidden truncate",
  variants: {
    level: {
      1: "text-2xl",
      2: "text-lg",
      3: "text-md",
    },
  },
});

type HeadingLevel = 1 | 2 | 3;
type HeadingTag = "h1" | "h2" | "h3" | "span" | "p";
type DashboardHeadingProps = PropsWithChildren<{ level: HeadingLevel; as?: HeadingTag; className?: string }>;

const tags = { 1: "h1", 2: "h2", 3: "h3" } as const;

function DashboardHeadingBase({ children, level, as, className }: DashboardHeadingProps) {
  const Tag = as ?? tags[level];
  return <Tag className={dashboardHeading({ level, className })}>{children}</Tag>;
}

export function DashboardHeading1({ children, as, className }: Omit<DashboardHeadingProps, "level">) {
  return <DashboardHeadingBase level={1} as={as} className={className}>{children}</DashboardHeadingBase>;
}

export function DashboardHeading2({ children, as, className }: Omit<DashboardHeadingProps, "level">) {
  return <DashboardHeadingBase level={2} as={as} className={className}>{children}</DashboardHeadingBase>;
}

export function DashboardHeading3({ children, as, className }: Omit<DashboardHeadingProps, "level">) {
  return <DashboardHeadingBase level={3} as={as} className={className}>{children}</DashboardHeadingBase>;
}

type DashboardSectionProps = {
  title: ReactNode;
  description: ReactNode;
  level?: HeadingLevel;
  headingClassName?: string;
};

export function DashboardSection({ title, description, level = 2, headingClassName }: DashboardSectionProps) {
  return (
    <div className="flex flex-col px-0.5 pt-4">
      <DashboardHeadingBase level={level} className={headingClassName}>{title}</DashboardHeadingBase>
      <Text size="sm">{description}</Text>
    </div>
  );
}
