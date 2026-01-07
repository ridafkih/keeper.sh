import { FC, PropsWithChildren } from "react";
import clsx from "clsx";

type CopyProps = {
  className?: string;
};

export const Copy: FC<PropsWithChildren<CopyProps>> = ({ children, className }) => (
  <p className={clsx("text-neutral-600 text-sm leading-relaxed", className)}>
    {children}
  </p>
);
