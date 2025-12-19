"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sidebarLink } from "@/styles";

const sidebarItems = [
  { href: "/dashboard", label: "Calendars" },
  { href: "/dashboard/integrations", label: "Integrations" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 w-48 shrink-0">
      {sidebarItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={sidebarLink({ active: pathname === item.href })}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
