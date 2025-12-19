"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@base-ui-components/react/button";
import { useAuth } from "@/components/auth-provider";
import { signOut } from "@/lib/auth";
import styles from "./header.module.css";

export function AuthNav() {
  const router = useRouter();
  const { user, isLoading, refresh } = useAuth();

  async function handleLogout() {
    await signOut();
    await refresh();
    router.push("/");
  }

  if (isLoading) {
    return <nav className={styles.nav} />;
  }

  if (user) {
    return (
      <nav className={styles.nav}>
        <Button onClick={handleLogout} className={styles.buttonSecondary}>
          Logout
        </Button>
      </nav>
    );
  }

  return (
    <nav className={styles.nav}>
      <Button
        render={<Link href="/login" />}
        nativeButton={false}
        className={styles.buttonSecondary}
      >
        Login
      </Button>
      <Button
        render={<Link href="/register" />}
        nativeButton={false}
        className={styles.buttonPrimary}
      >
        Register
      </Button>
    </nav>
  );
}
