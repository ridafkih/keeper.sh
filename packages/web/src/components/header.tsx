"use client";

import type { FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNav } from "@/components/auth-nav";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import KeeperLogo from "@/assets/keeper.svg";

const authRoutes = new Set(["/login", "/register"]);

export const Header: FC = () => {
  const pathname = usePathname();
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute = authRoutes.has(pathname);
  const showMarketingNav = !isDashboard && !isAuthRoute;

  return (
    <header className="flex justify-between items-center max-w-3xl mx-auto px-4 py-3.5 pr-5 w-full">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="px-1.5 text-base font-semibold text-foreground no-underline tracking-tight hover:bg-surface-subtle rounded-md flex items-center gap-1.5"
        >
          <KeeperLogo aria-label="The Keeper logo" className="size-3 text-foreground" />
          Keeper
        </Link>
        {showMarketingNav && <MarketingNav />}
      </div>
      <AuthNav />
    </header>
  );
};
