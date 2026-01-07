import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import { tv } from "tailwind-variants";

const menuCheckboxItemStyle = tv({
  base: "flex items-center gap-2 px-2 py-1 text-xs rounded text-foreground-secondary hover:bg-surface-muted cursor-pointer select-none",
});

const indicatorStyle = tv({
  base: "size-4 flex items-center justify-center opacity-25 data-[checked]:opacity-100",
});

type BaseMenuCheckboxItemProps = ComponentProps<typeof Menu.CheckboxItem>;

interface MenuCheckboxItemProps extends Omit<BaseMenuCheckboxItemProps, "className"> {
  className?: string;
}

export const MenuCheckboxItem: FC<PropsWithChildren<MenuCheckboxItemProps>> = ({
  className,
  children,
  ...props
}) => (
  <Menu.CheckboxItem className={menuCheckboxItemStyle({ className })} {...props}>
    <Menu.CheckboxItemIndicator className={indicatorStyle()} keepMounted>
      <Check size={12} />
    </Menu.CheckboxItemIndicator>
    <span className="flex-1">{children}</span>
  </Menu.CheckboxItem>
);
