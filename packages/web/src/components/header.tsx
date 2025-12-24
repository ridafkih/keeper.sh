"use client";

import type { FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNav } from "@/components/auth-nav";
import { MarketingNav } from "@/components/marketing-nav";

const authRoutes = ["/login", "/register"];

export const Header: FC = () => {
  const pathname = usePathname();
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute = authRoutes.includes(pathname);
  const showMarketingNav = !isDashboard && !isAuthRoute;

  return (
    <header>
      <div className="flex justify-between items-center max-w-3xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="px-1.5 text-base font-semibold text-foreground no-underline tracking-tight hover:bg-surface-subtle rounded-md"
          >
            Keeper
          </Link>
          {showMarketingNav && <MarketingNav />}
        </div>
        <AuthNav />
      </div>
    </header>
  );
};
