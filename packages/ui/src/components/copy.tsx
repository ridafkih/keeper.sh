import type { ElementType, ComponentPropsWithoutRef } from "react";
import { tv } from "tailwind-variants";
import { cn } from "../utils/cn";

const copyVariants = tv({
  base: "leading-relaxed",
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
    },
    color: {
      primary: "text-foreground",
      secondary: "text-foreground-secondary",
      tertiary: "text-foreground-muted",
      muted: "text-foreground-subtle",
      error: "text-red-600",
      success: "text-green-600",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
    },
  },
  defaultVariants: {
    size: "sm",
    color: "secondary",
    weight: "normal",
  },
});

type CopyProps<AsComponent extends ElementType = "p"> = {
  as?: AsComponent;
  className?: string;
  size?: "xs" | "sm" | "base" | "lg";
  color?: "primary" | "secondary" | "tertiary" | "muted" | "error" | "success";
  weight?: "normal" | "medium" | "semibold";
} & ComponentPropsWithoutRef<AsComponent>;

const Copy = <AsComponent extends ElementType = "p">({
  as,
  children,
  className,
  size,
  color,
  weight,
  ...props
}: CopyProps<AsComponent>) => {
  const Component = as ?? "p";

  return (
    <Component
      className={cn(copyVariants({ size, color, weight }), className)}
      {...props}
    >
      {children}
    </Component>
  );
};

Copy.displayName = "Copy";

export { Copy };
export type { CopyProps };
