"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { useAuth } from "@/components/auth-provider";
import { signOut } from "@/lib/auth";
import { button } from "@/styles";

const AuthNavSkeleton = ({ isDashboard }: { isDashboard: boolean }) => {
  if (isDashboard) {
    return (
      <nav className="flex gap-2">
        <Button className={button({ variant: "secondary", size: "xs", skeleton: true })} disabled>
          Logout
        </Button>
      </nav>
    );
  }

  return (
    <nav className="flex gap-2">
      <Button className={button({ variant: "secondary", size: "xs", skeleton: true })} disabled>
        Login
      </Button>
      <Button className={button({ variant: "primary", size: "xs", skeleton: true })} disabled>
        Register
      </Button>
    </nav>
  );
};

const DashboardNav = ({ onLogout }: { onLogout: () => void }) => (
  <nav className="flex gap-2">
    <Button onClick={onLogout} className={button({ variant: "secondary", size: "xs" })}>
      Logout
    </Button>
  </nav>
);

const AuthenticatedMarketingNav = () => (
  <nav className="flex gap-2">
    <Button
      render={<Link href="/dashboard" />}
      nativeButton={false}
      className={button({ variant: "primary", size: "xs" })}
    >
      Dashboard
    </Button>
  </nav>
);

const UnauthenticatedNav = () => (
  <nav className="flex gap-2">
    <Button
      render={<Link href="/login" />}
      nativeButton={false}
      className={button({ variant: "secondary", size: "xs" })}
    >
      Login
    </Button>
    <Button
      render={<Link href="/register" />}
      nativeButton={false}
      className={button({ variant: "primary", size: "xs" })}
    >
      Register
    </Button>
  </nav>
);

export function AuthNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, refresh } = useAuth();
  const isDashboard = pathname.startsWith("/dashboard");

  const handleLogout = async () => {
    await signOut();
    await refresh();
    router.push("/");
  };

  if (isLoading) {
    return <AuthNavSkeleton isDashboard={isDashboard} />;
  }

  if (user) {
    if (isDashboard) {
      return <DashboardNav onLogout={handleLogout} />;
    }
    return <AuthenticatedMarketingNav />;
  }

  return <UnauthenticatedNav />;
}
