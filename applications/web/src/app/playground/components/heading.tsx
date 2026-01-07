import { FC, ReactNode } from "react";
import { Lora } from "next/font/google";
import clsx from "clsx";

const lora = Lora();

type HeadingProps = {
  children: ReactNode;
  className?: string;
};

export const Heading1: FC<HeadingProps> = ({ children, className }) => (
  <h1
    className={clsx(
      lora.className,
      "text-4xl font-medium leading-tight -tracking-[0.075em]",
      className
    )}
  >
    {children}
  </h1>
);

export const Heading2: FC<HeadingProps> = ({ children, className }) => (
  <h2
    className={clsx(
      lora.className,
      "text-2xl font-medium leading-tight -tracking-[0.075em]",
      className
    )}
  >
    {children}
  </h2>
);

export const Heading3: FC<HeadingProps> = ({ children, className }) => (
  <h2
    className={clsx(
      lora.className,
      "text-xl font-medium leading-tight -tracking-[0.075em]",
      className
    )}
  >
    {children}
  </h2>
);
