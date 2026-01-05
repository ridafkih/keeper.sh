import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Menu } from "@base-ui/react/menu";
import { tv } from "tailwind-variants";

const menuPopupStyle = tv({
  base: "bg-surface-elevated border border-border rounded-md shadow-lg p-1",
  variants: {
    minWidth: {
      md: "min-w-30",
      sm: "min-w-24",
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
  <Menu.Popup className={menuPopupStyle({ className, minWidth })} {...props}>
    {children}
  </Menu.Popup>
);
