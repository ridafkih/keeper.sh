"use client";

import Link from "next/link";
import { Button } from "@base-ui-components/react/button";
import { useAuth } from "@/components/auth-provider";

const buttonSecondaryClassName =
  "inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium no-underline cursor-pointer transition-colors duration-150 bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const buttonPrimaryClassName =
  "inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium no-underline cursor-pointer transition-colors duration-150 bg-gray-900 border border-gray-900 text-white hover:bg-gray-700 hover:border-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export function AuthNav() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <nav className="flex gap-3" />;
  }

  if (user) {
    return (
      <nav className="flex gap-3">
        <Button
          render={<Link href="/dashboard" />}
          nativeButton={false}
          className={buttonPrimaryClassName}
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
        className={buttonSecondaryClassName}
      >
        Login
      </Button>
      <Button
        render={<Link href="/register" />}
        nativeButton={false}
        className={buttonPrimaryClassName}
      >
        Register
      </Button>
    </nav>
  );
}
