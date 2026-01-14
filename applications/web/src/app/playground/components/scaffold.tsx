import type { FC, PropsWithChildren } from "react";
import { cn } from "../utils/cn";

interface ScaffoldProps {
  className?: string;
}

export const Scaffold: FC<PropsWithChildren<ScaffoldProps>> = ({ children, className }) => (
  <div
    className={cn(
      "w-full grow grid grid-cols-[minmax(1rem,1fr)_minmax(auto,28rem)_minmax(1rem,1fr)] *:col-start-2 dark:bg-neutral-950 grid-rows-[1fr_auto]",
      className,
    )}
  >
    {children}
  </div>
);
