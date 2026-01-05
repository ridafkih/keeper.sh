import type { FC, PropsWithChildren, ComponentProps } from "react";
import { Menu } from "@base-ui/react/menu";
import { tv } from "tailwind-variants";

const menuItemStyle = tv({
  base: "flex items-center gap-2 px-2 py-1 text-xs rounded",
  variants: {
    variant: {
      default: "text-foreground-secondary hover:bg-surface-muted cursor-pointer",
      danger: "text-destructive hover:bg-surface-muted cursor-pointer",
      disabled: "text-foreground-subtle cursor-not-allowed",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type BaseMenuItemProps = ComponentProps<typeof Menu.Item>;

interface MenuItemProps extends Omit<BaseMenuItemProps, "className"> {
  variant?: "default" | "danger" | "disabled";
  className?: string;
}

export const MenuItem: FC<PropsWithChildren<MenuItemProps>> = ({
  variant,
  className,
  children,
  ...props
}) => (
  <Menu.Item className={menuItemStyle({ variant, className })} {...props}>
    {children}
  </Menu.Item>
);
