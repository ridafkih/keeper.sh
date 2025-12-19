"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNav } from "@/components/auth-nav";
import { MarketingNav } from "@/components/marketing-nav";
import { brand } from "@/styles";

const authRoutes = ["/login", "/register"];

export function Header() {
  const pathname = usePathname();
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute = authRoutes.includes(pathname);
  const showMarketingNav = !isDashboard && !isAuthRoute;

  return (
    <header className="border-b border-neutral-200">
      <div className="flex justify-between items-center max-w-3xl mx-auto p-4">
        <div className="flex items-center gap-6">
          <Link href="/" className={brand()}>
            Keeper
          </Link>
          {showMarketingNav && <MarketingNav />}
        </div>
        <AuthNav />
      </div>
    </header>
  );
}
