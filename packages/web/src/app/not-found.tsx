import type { ReactNode } from "react";
import Link from "next/link";

export default function NotFound(): ReactNode {
  return (
    <main className="flex flex-col items-center justify-center flex-1 gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="text-foreground-muted">The page you're looking for doesn't exist.</p>
      <Link href="/" className="text-foreground font-medium hover:underline">
        Go home
      </Link>
    </main>
  );
}
