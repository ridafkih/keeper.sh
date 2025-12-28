"use client";

import type { FC } from "react";
import NextLink from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { NavLink } from "@/components/nav-link";
import clsx from "clsx";

const navItems = [
  { href: "/features", label: "Features", showOnMobile: false },
  { href: "/pricing", label: "Pricing", showOnMobile: false },
  {
    href: "https://github.com/ridafkih/keeper.sh",
    label: "GitHub",
    external: true,
    showOnMobile: false,
  },
  {
    href: "https://github.com/ridafkih/keeper.sh/releases",
    label: "Changelog",
    external: true,
    showOnMobile: true,
  },
] as const;

export const MarketingNav: FC = () => (
  <NavigationMenu.Root className="flex">
    <NavigationMenu.List className="flex gap-1">
      {navItems.map((item) => (
        <NavigationMenu.Item
          className={clsx(!item.showOnMobile && "hidden sm:block")}
          key={item.href}
        >
          <NavLink
            href={item.href}
            render={
              "external" in item && item.external ? (
                <a href={item.href} target="_blank" rel="noopener noreferrer" />
              ) : (
                <NextLink href={item.href} />
              )
            }
          >
            {item.label}
          </NavLink>
        </NavigationMenu.Item>
      ))}
    </NavigationMenu.List>
  </NavigationMenu.Root>
);
