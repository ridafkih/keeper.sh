import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Menu } from "@base-ui/react/menu";
import { tv } from "tailwind-variants";

const menuItemStyle = tv({
  base: "flex items-center gap-2 px-2 py-1 text-xs rounded",
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      danger: "text-destructive hover:bg-surface-muted cursor-pointer",
      default: "text-foreground-secondary hover:bg-surface-muted cursor-pointer",
      disabled: "text-foreground-subtle cursor-not-allowed",
    },
  },
});

type BaseMenuItemProps = ComponentProps<typeof Menu.Item>;

interface MenuItemProps extends Omit<BaseMenuItemProps, "className"> {
  variant?: "default" | "danger" | "disabled";
  className?: string;
}

const MenuItem: FC<PropsWithChildren<MenuItemProps>> = ({
  variant,
  className,
  children,
  ...props
}) => (
  <Menu.Item className={menuItemStyle({ className, variant })} {...props}>
    {children}
  </Menu.Item>
);

export { MenuItem };
