import type { FC, PropsWithChildren } from "react";
import { Lora as googleFont } from "next/font/google";
import { clsx } from "clsx";

const lora = googleFont();

interface HeadingProps {
  className?: string;
}

const Heading1: FC<PropsWithChildren<HeadingProps>> = ({ children, className }) => (
  <h1
    className={clsx(
      lora.className,
      "text-4xl font-medium leading-tight -tracking-[0.075em]",
      className,
    )}
  >
    {children}
  </h1>
);

const Heading2: FC<PropsWithChildren<HeadingProps>> = ({ children, className }) => (
  <h2
    className={clsx(
      lora.className,
      "text-2xl font-medium leading-tight -tracking-[0.075em]",
      className,
    )}
  >
    {children}
  </h2>
);

const Heading3: FC<PropsWithChildren<HeadingProps>> = ({ children, className }) => (
  <h2
    className={clsx(
      lora.className,
      "text-xl font-medium leading-tight -tracking-[0.075em]",
      className,
    )}
  >
    {children}
  </h2>
);

export { Heading1, Heading2, Heading3 };
