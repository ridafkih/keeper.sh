import type { FC, PropsWithChildren, ComponentProps } from "react";
import { Button } from "@base-ui/react/button";
import { tv } from "tailwind-variants";

const ghostButton = tv({
  base: "text-xs px-2 py-1 rounded-md cursor-pointer transition-colors",
  variants: {
    variant: {
      default: "text-foreground-muted hover:text-foreground hover:bg-surface-subtle",
      danger: "text-destructive hover:text-destructive-emphasis hover:bg-surface-subtle",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type ButtonProps = ComponentProps<typeof Button>;

interface GhostButtonProps extends Omit<ButtonProps, "className"> {
  variant?: "default" | "danger";
  className?: string;
}

export const GhostButton: FC<PropsWithChildren<GhostButtonProps>> = ({
  variant,
  className,
  children,
  ...props
}) => (
  <Button className={ghostButton({ variant, className })} {...props}>
    {children}
  </Button>
);
