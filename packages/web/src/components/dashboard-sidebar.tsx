"use client";

import type { FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Puzzle,
  CreditCard,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { tv } from "tailwind-variants";

const sidebarLink = tv({
  base: "flex items-center text-sm gap-1 py-1 px-1.5 pr-8 rounded-sm tracking-tight",
  variants: {
    active: {
      true: "bg-surface-muted text-foreground",
      false: "text-foreground-secondary hover:text-foreground hover:bg-surface-subtle",
    },
  },
  defaultVariants: {
    active: false,
  },
});

const sidebarItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Agenda", icon: CalendarDays },
  { href: "/dashboard/integrations", label: "Integrations", icon: Puzzle },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export const DashboardSidebar: FC = () => {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 shrink-0 sticky top-2 self-start">
      {sidebarItems.map((item) => (
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
