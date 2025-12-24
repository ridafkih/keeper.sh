"use client";

import type { FC } from "react";
import NextLink from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { NavLink } from "@/components/nav-link";

const navItems = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  {
    href: "https://github.com/ridafkih/keeper.sh",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://github.com/ridafkih/keeper.sh/releases",
    label: "Changelog",
    external: true,
  },
] as const;

export const MarketingNav: FC = () => (
  <NavigationMenu.Root className="flex">
    <NavigationMenu.List className="flex gap-1">
      {navItems.map((item) => (
        <NavigationMenu.Item key={item.href}>
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
