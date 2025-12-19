import Link from "next/link";
import { AuthNav } from "@/components/auth-nav";

export function Header() {
  return (
    <header className="border-b border-neutral-200">
      <div className="flex justify-between items-center max-w-3xl mx-auto p-4">
        <Link
          href="/"
          className="text-2xl font-bold text-gray-900 no-underline"
        >
          Keeper
        </Link>
        <AuthNav />
      </div>
    </header>
  );
}
