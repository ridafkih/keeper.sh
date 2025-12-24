"use client";

import NextLink from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";

const navItems = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
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

export function MarketingNav() {
  return (
    <NavigationMenu.Root className="flex">
      <NavigationMenu.List className="flex gap-1">
        {navItems.map((item) => (
          <NavigationMenu.Item key={item.href}>
            <NavigationMenu.Link
              href={item.href}
              render={
                "external" in item && item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ) : (
                  <NextLink href={item.href} />
                )
              }
              className="flex items-center px-2 py-1 rounded-md text-xs font-medium no-underline transition-colors text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
            >
              {item.label}
            </NavigationMenu.Link>
          </NavigationMenu.Item>
        ))}
      </NavigationMenu.List>
    </NavigationMenu.Root>
  );
}
