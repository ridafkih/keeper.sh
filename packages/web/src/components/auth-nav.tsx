"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { useAuth } from "@/components/auth-provider";
import { signOut } from "@/lib/auth";
import { button } from "@/styles";

export function AuthNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, refresh } = useAuth();
  const isDashboard = pathname.startsWith("/dashboard");

  async function handleLogout() {
    await signOut();
    await refresh();
    router.push("/");
  }

  if (isLoading) {
    if (isDashboard) {
      return (
        <nav className="flex gap-3">
          <Button className={clsx(button({ variant: "secondary" }), "!opacity-0")} disabled>
            Logout
          </Button>
        </nav>
      );
    }

    return (
      <nav className="flex gap-3">
        <Button className={clsx(button({ variant: "secondary" }), "!opacity-0")} disabled>
          Login
        </Button>
        <Button className={clsx(button({ variant: "primary" }), "!opacity-0")} disabled>
          Register
        </Button>
      </nav>
    );
  }

  if (user) {
    if (isDashboard) {
      return (
        <nav className="flex gap-3">
          <Button
            onClick={handleLogout}
            className={button({ variant: "secondary" })}
          >
            Logout
          </Button>
        </nav>
      );
    }

    return (
      <nav className="flex gap-3">
        <Button
          render={<Link href="/dashboard" />}
          nativeButton={false}
          className={button({ variant: "primary" })}
        >
          Dashboard
        </Button>
      </nav>
    );
  }

  return (
    <nav className="flex gap-3">
      <Button
        render={<Link href="/login" />}
        nativeButton={false}
        className={button({ variant: "secondary" })}
      >
        Login
      </Button>
      <Button
        render={<Link href="/register" />}
        nativeButton={false}
        className={button({ variant: "primary" })}
      >
        Register
      </Button>
    </nav>
  );
}
