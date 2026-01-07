import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Button } from "@base-ui/react/button";
import { tv } from "tailwind-variants";

const ghostButton = tv({
  base: "text-xs px-2 py-1 rounded-md cursor-pointer transition-colors",
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      danger: "text-destructive hover:text-destructive-emphasis hover:bg-surface-subtle",
      default: "text-foreground-muted hover:text-foreground hover:bg-surface-subtle",
    },
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
  <Button className={ghostButton({ className, variant })} {...props}>
    {children}
  </Button>
);
