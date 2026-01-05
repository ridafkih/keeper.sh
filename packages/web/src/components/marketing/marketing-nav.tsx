"use client";

import type { FC, ReactElement } from "react";
import NextLink from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { NavLink } from "@/components/nav-link";
import { clsx } from "clsx";

const navItems = [
  { href: "/features", label: "Features", showOnMobile: false },
  { href: "/pricing", label: "Pricing", showOnMobile: false },
  {
    external: true,
    href: "https://github.com/ridafkih/keeper.sh",
    label: "GitHub",
    showOnMobile: false,
  },
  {
    external: true,
    href: "https://github.com/ridafkih/keeper.sh/releases",
    label: "Changelog",
    showOnMobile: true,
  },
] as const;

const renderNavItemLink = (navItem: (typeof navItems)[number]): ReactElement => {
  if ("external" in navItem && navItem.external) {
    return (
      <a href={navItem.href} target="_blank" rel="noopener noreferrer" aria-label={navItem.label} />
    );
  }
  return <NextLink href={navItem.href} aria-label={navItem.label} />;
};

export const MarketingNav: FC = () => (
  <NavigationMenu.Root className="flex">
    <NavigationMenu.List className="flex gap-1">
      {navItems.map((item) => {
        const linkRender = renderNavItemLink(item);
        return (
          <NavigationMenu.Item
            className={clsx(!item.showOnMobile && "hidden sm:block")}
            key={item.href}
          >
            <NavLink href={item.href} render={linkRender}>
              {item.label}
            </NavLink>
          </NavigationMenu.Item>
        );
      })}
    </NavigationMenu.List>
  </NavigationMenu.Root>
);
