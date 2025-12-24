import type { FC, PropsWithChildren, ComponentProps } from "react";
import { Menu } from "@base-ui/react/menu";
import { tv } from "tailwind-variants";

const menuPopupStyle = tv({
  base: "bg-surface-elevated border border-border rounded-md shadow-lg p-1",
  variants: {
    minWidth: {
      sm: "min-w-24",
      md: "min-w-30",
    },
  },
});

type BaseMenuPopupProps = ComponentProps<typeof Menu.Popup>;

interface MenuPopupProps extends Omit<BaseMenuPopupProps, "className"> {
  minWidth?: "sm" | "md";
  className?: string;
}

export const MenuPopup: FC<PropsWithChildren<MenuPopupProps>> = ({
  minWidth,
  className,
  children,
  ...props
}) => (
  <Menu.Popup className={menuPopupStyle({ minWidth, className })} {...props}>
    {children}
  </Menu.Popup>
);
