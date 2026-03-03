import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

const heading = tv({
  base: "font-serif font-medium leading-tight -tracking-[0.075em] text-foreground",
  variants: {
    level: {
      1: "text-4xl",
      2: "text-xl",
      3: "text-lg",
    },
  },
});

type HeadingLevel = 1 | 2 | 3;
type HeadingProps = PropsWithChildren<{ level: HeadingLevel; as?: HeadingLevel; className?: string }>;

const tags = { 1: "h1", 2: "h2", 3: "h3" } as const;

function HeadingBase({ children, level, as, className }: HeadingProps) {
  const Tag = tags[as ?? level];
  return <Tag className={heading({ level, className })}>{children}</Tag>;
}

export function Heading1({ children, as, className }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={1} as={as} className={className}>{children}</HeadingBase>;
}

export function Heading2({ children, as, className }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={2} as={as} className={className}>{children}</HeadingBase>;
}

export function Heading3({ children, as, className }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={3} as={as} className={className}>{children}</HeadingBase>;
}
