"use client";

import type { FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CreditCard, Puzzle, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import { isCommercialMode } from "@/config/mode";

const sidebarLink = tv({
  base: "flex items-center text-sm gap-1 py-1 px-1.5 pr-8 rounded-sm tracking-tight",
  defaultVariants: {
    active: false,
  },
  variants: {
    active: {
      false: "text-foreground-secondary hover:text-foreground hover:bg-surface-subtle",
      true: "bg-surface-muted text-foreground",
    },
  },
});

interface SidebarItem {
  href: string;
  label: string;
  icon: LucideIcon;
  commercialOnly?: boolean;
}

const sidebarItems: SidebarItem[] = [
  { href: "/dashboard", icon: CalendarDays, label: "Agenda" },
  { href: "/dashboard/integrations", icon: Puzzle, label: "Integrations" },
  {
    commercialOnly: true,
    href: "/dashboard/billing",
    icon: CreditCard,
    label: "Billing",
  },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

const filterItemsByMode = (items: SidebarItem[], isCommercial: boolean): SidebarItem[] => {
  if (isCommercial) {
    return items;
  }
  return items.filter((item) => !item.commercialOnly);
};

export const DashboardSidebar: FC = () => {
  const pathname = usePathname();
  const visibleItems = filterItemsByMode(sidebarItems, isCommercialMode);

  return (
    <nav className="flex flex-col gap-0.5 shrink-0 sticky top-2 self-start">
      {visibleItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={sidebarLink({ active: pathname === item.href })}
        >
          <item.icon size={15} />
          {item.label}
        </Link>
      ))}
    </nav>
  );
};
