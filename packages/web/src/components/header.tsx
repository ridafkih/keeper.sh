"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNav } from "@/components/auth-nav";
import { MarketingNav } from "@/components/marketing-nav";

const authRoutes = ["/login", "/register"];

export function Header() {
  const pathname = usePathname();
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute = authRoutes.includes(pathname);
  const showMarketingNav = !isDashboard && !isAuthRoute;

  return (
    <header className="border-b border-zinc-200">
      <div className="flex justify-between items-center max-w-3xl mx-auto px-4 py-2.5">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-base font-semibold text-zinc-900 no-underline tracking-tight"
          >
            Keeper
          </Link>
          {showMarketingNav && <MarketingNav />}
        </div>
        <AuthNav />
      </div>
    </header>
  );
}
