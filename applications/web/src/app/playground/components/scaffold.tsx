import { FC, ReactNode } from "react";
import clsx from "clsx";

type ScaffoldProps = {
  children: ReactNode;
  className?: string;
};

export const Scaffold: FC<ScaffoldProps> = ({ children, className }) => (
  <div
    className={clsx(
      "w-full grow grid grid-cols-[minmax(2rem,1fr)_28rem_minmax(2rem,1fr)] *:col-start-2 bg-neutral-50 dark:bg-neutral-950",
      className
    )}
  >
    {children}
  </div>
);
