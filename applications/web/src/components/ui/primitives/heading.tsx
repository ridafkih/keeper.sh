import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

const heading = tv({
  base: "font-lora font-medium leading-tight -tracking-[0.075em] text-foreground",
  variants: {
    level: {
      1: "text-4xl",
      2: "text-2xl",
      3: "text-xl",
    },
  },
});

type HeadingLevel = 1 | 2 | 3;
type HeadingTag = "h1" | "h2" | "h3" | "span" | "p";
type HeadingProps = PropsWithChildren<{
  level: HeadingLevel;
  as?: HeadingTag;
  className?: string;
  id?: string;
}>;

const tags = { 1: "h1", 2: "h2", 3: "h3" } as const;

function HeadingBase({ children, level, as, className, id }: HeadingProps) {
  const Tag = as ?? tags[level];
  return <Tag className={heading({ level, className })} id={id}>{children}</Tag>;
}

export function Heading1({ children, as, className, id }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={1} as={as} className={className} id={id}>{children}</HeadingBase>;
}

export function Heading2({ children, as, className, id }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={2} as={as} className={className} id={id}>{children}</HeadingBase>;
}

export function Heading3({ children, as, className, id }: Omit<HeadingProps, "level">) {
  return <HeadingBase level={3} as={as} className={className} id={id}>{children}</HeadingBase>;
}
