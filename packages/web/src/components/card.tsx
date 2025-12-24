import type { FC, PropsWithChildren } from "react";
import { tv } from "tailwind-variants";

const card = tv({
  base: "border rounded-md",
  variants: {
    variant: {
      default: "border-border",
      danger: "border-destructive-border bg-destructive-surface",
    },
    padding: {
      none: "",
      sm: "p-3",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "none",
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
}) => <div className={card({ variant, padding, className })}>{children}</div>;
