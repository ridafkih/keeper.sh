import { FC, ReactNode } from "react";
import clsx from "clsx";

type CopyProps = {
  children: ReactNode;
  className?: string;
};

export const Copy: FC<CopyProps> = ({ children, className }) => (
  <p className={clsx("text-neutral-600 text-sm leading-relaxed", className)}>
    {children}
  </p>
);
