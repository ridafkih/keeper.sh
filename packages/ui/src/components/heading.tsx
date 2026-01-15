import type { FC, PropsWithChildren } from "react";
import { Lora as googleFont } from "next/font/google";
import { cn } from "../utils/cn";

const lora = googleFont();

interface HeadingProps {
  className?: string;
  id?: string;
}

const Heading1: FC<PropsWithChildren<HeadingProps>> = ({ children, className, id }) => (
  <h1
    id={id}
    className={cn(
      lora.className,
      "text-4xl font-medium leading-tight -tracking-[0.075em] text-foreground",
      className,
    )}
  >
    {children}
  </h1>
);

const Heading2: FC<PropsWithChildren<HeadingProps>> = ({ children, className, id }) => (
  <h2
    id={id}
    className={cn(
      lora.className,
      "text-2xl font-medium leading-tight -tracking-[0.075em] text-foreground",
      className,
    )}
  >
    {children}
  </h2>
);

const Heading3: FC<PropsWithChildren<HeadingProps>> = ({ children, className, id }) => (
  <h3
    id={id}
    className={cn(
      lora.className,
      "text-xl font-medium leading-tight -tracking-[0.075em] text-foreground",
      className,
    )}
  >
    {children}
  </h3>
);

Heading1.displayName = "Heading1";
Heading2.displayName = "Heading2";
Heading3.displayName = "Heading3";

export { Heading1, Heading2, Heading3 };
export type { HeadingProps };
