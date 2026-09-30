import type { PropsWithChildren } from "react";
import { heading } from "./heading.styles";

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
