import type { FC } from "react";
import { clsx } from "clsx";

interface DividerProps {
  variant?: "default" | "subtle";
}

const Divider: FC<DividerProps> = ({ variant = "default" }) => (
  <hr
    className={clsx(
      "border-t",
      variant === "default" && "border-neutral-200",
      variant === "subtle" && "border-neutral-100"
    )}
  />
);

export { Divider };
