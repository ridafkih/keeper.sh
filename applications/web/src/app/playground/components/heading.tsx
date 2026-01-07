import { FC, ReactNode } from "react";
import { Lora } from "next/font/google";
import clsx from "clsx";

const lora = Lora();

type Heading1Props = {
  children: ReactNode;
  className?: string;
};

export const Heading1: FC<Heading1Props> = ({ children, className }) => (
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
