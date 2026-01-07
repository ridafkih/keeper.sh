import type { FC } from "react";
import { tv } from "tailwind-variants";

const spinner = tv({
  base: "animate-spin rounded-full border-2 border-current border-t-transparent",
  defaultVariants: {
    size: "sm",
  },
  variants: {
    size: {
      md: "size-4",
      sm: "size-3",
    },
  },
});

interface SpinnerProps {
  size?: "sm" | "md";
  className?: string;
}

export const Spinner: FC<SpinnerProps> = ({ size, className }) => (
  <span className={spinner({ className, size })} />
);
