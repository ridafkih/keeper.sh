import type { FC, PropsWithChildren } from "react";
import { tv } from "tailwind-variants";

const iconBox = tv({
  base: "grid place-items-center rounded shrink-0",
  defaultVariants: {
    size: "md",
    variant: "default",
  },
  variants: {
    size: {
      lg: "size-10",
      md: "size-8",
      sm: "size-6",
    },
    variant: {
      default: "bg-surface-muted",
      muted: "bg-surface-subtle",
    },
  },
});

interface IconBoxProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "muted";
  className?: string;
}

export const IconBox: FC<PropsWithChildren<IconBoxProps>> = ({
  children,
  size,
  variant,
  className,
}) => <div className={iconBox({ className, size, variant })}>{children}</div>;
