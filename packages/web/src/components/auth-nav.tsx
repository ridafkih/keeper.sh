"use client";

import type { FC } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { useAuth } from "@/components/auth-provider";
import { signOut } from "@/lib/auth";
import { button } from "@/styles";

interface AuthNavSkeletonProps {
  isDashboard: boolean;
}

const AuthNavSkeleton: FC<AuthNavSkeletonProps> = ({ isDashboard }) => {
  if (isDashboard) {
    return (
      <nav className="flex gap-2">
        <Button
          className={button({
            size: "xs",
            skeleton: true,
            variant: "secondary",
          })}
          disabled
        >
          Logout
        </Button>
      </nav>
    );
  }

  return (
    <nav className="flex gap-2">
      <Button className={button({ size: "xs", skeleton: true, variant: "secondary" })} disabled>
        Login
      </Button>
      <Button className={button({ size: "xs", skeleton: true, variant: "primary" })} disabled>
        Register
      </Button>
    </nav>
  );
};

interface DashboardNavProps {
  onLogout: () => void;
}

const DashboardNav: FC<DashboardNavProps> = ({ onLogout }) => (
  <nav className="flex gap-2">
    <Button onClick={onLogout} className={button({ size: "xs", variant: "secondary" })}>
      Logout
    </Button>
  </nav>
);

const AuthenticatedMarketingNav: FC = () => (
  <nav className="flex gap-2">
    <Button
      render={<Link href="/dashboard" />}
      nativeButton={false}
      className={button({ size: "xs", variant: "primary" })}
    >
      Dashboard
    </Button>
  </nav>
);

const UnauthenticatedNav: FC = () => (
  <nav className="flex gap-2">
    <Button
      render={<Link href="/login" />}
      nativeButton={false}
      className={button({ size: "xs", variant: "secondary" })}
    >
      Login
    </Button>
    <Button
      render={<Link href="/register" />}
      nativeButton={false}
      className={button({ size: "xs", variant: "primary" })}
    >
      Register
    </Button>
  </nav>
);

export const AuthNav: FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, refresh } = useAuth();
  const isDashboard = pathname.startsWith("/dashboard");

  const handleLogout = async (): Promise<void> => {
    await signOut();
    await refresh();
    router.push("/");
  };

  if (isLoading) {
    return <AuthNavSkeleton isDashboard={isDashboard} />;
  }
  if (!user) {
    return <UnauthenticatedNav />;
  }
  if (!isDashboard) {
    return <AuthenticatedMarketingNav />;
  }
  return <DashboardNav onLogout={handleLogout} />;
};
