import type { FC, PropsWithChildren } from "react";
import { tv } from "tailwind-variants";

const iconBox = tv({
  base: "grid place-items-center rounded shrink-0",
  variants: {
    size: {
      sm: "size-6",
      md: "size-8",
      lg: "size-10",
    },
    variant: {
      default: "bg-surface-muted",
      muted: "bg-surface-subtle",
    },
  },
  defaultVariants: {
    size: "md",
    variant: "default",
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
}) => <div className={iconBox({ size, variant, className })}>{children}</div>;
