import { FC, PropsWithChildren } from "react";
import clsx from "clsx";

type ScaffoldProps = {
  className?: string;
};

export const Scaffold: FC<PropsWithChildren<ScaffoldProps>> = ({ children, className }) => (
  <div
    className={clsx(
      "w-full grow grid grid-cols-[minmax(2rem,1fr)_minmax(auto,28rem)_minmax(2rem,1fr)] *:col-start-2 bg-neutral-50 dark:bg-neutral-950 py-8 gap-8",
      className
    )}
  >
    {children}
  </div>
);
