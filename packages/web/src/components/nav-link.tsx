import type { ComponentProps, FC, PropsWithChildren } from "react";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { tv } from "tailwind-variants";

const navLinkStyle = tv({
  base: "flex items-center px-2 py-1 rounded-md text-xs font-medium no-underline transition-colors text-foreground-muted hover:text-foreground hover:bg-surface-subtle",
});

type BaseNavLinkProps = ComponentProps<typeof NavigationMenu.Link>;

interface NavLinkProps extends Omit<BaseNavLinkProps, "className"> {
  className?: string;
}

export const NavLink: FC<PropsWithChildren<NavLinkProps>> = ({ className, children, ...props }) => (
  <NavigationMenu.Link className={navLinkStyle({ className })} {...props}>
    {children}
  </NavigationMenu.Link>
);
