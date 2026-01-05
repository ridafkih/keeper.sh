import type { FC, PropsWithChildren } from "react";
import { tv } from "tailwind-variants";

const card = tv({
  base: "border rounded-md",
  defaultVariants: {
    padding: "none",
    variant: "default",
  },
  variants: {
    padding: {
      none: "",
      sm: "p-3",
    },
    variant: {
      danger: "border-destructive-border bg-destructive-surface",
      default: "border-border",
    },
  },
});

interface CardProps {
  variant?: "default" | "danger";
  padding?: "none" | "sm";
  className?: string;
}

export const Card: FC<PropsWithChildren<CardProps>> = ({
  variant,
  padding,
  className,
  children,
}) => <div className={card({ className, padding, variant })}>{children}</div>;
