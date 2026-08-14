import type { PropsWithChildren } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutRow } from "@/components/ui/shells/layout";
import { StaggeredBackdropBlur } from "@/components/ui/primitives/staggered-backdrop-blur";

export function MarketingHeader({ children }: PropsWithChildren) {
  return (
    <div className="w-full sticky top-0 z-50">
      <StaggeredBackdropBlur />
      <LayoutRow className="relative z-10">
        <header className="flex justify-between items-center gap-2 py-3">
          {children}
        </header>
      </LayoutRow>
    </div>
  );
}

export function MarketingHeaderBranding({ children, label }: PropsWithChildren<{ label?: string }>) {
  return <Link to="/" className="flex items-center text-foreground hover:text-foreground-hover" aria-label={label}>{children}</Link>;
}

export function MarketingHeaderNav({ children }: PropsWithChildren) {
  return (
    <nav aria-label="Primary" className="hidden md:block mr-auto">
      <ul className="flex items-center gap-4 list-none tracking-tight font-light text-sm">
        {children}
      </ul>
    </nav>
  );
}

export function MarketingHeaderNavItem({ children, to }: PropsWithChildren<{ to: string }>) {
  return (
    <li>
      <Link
        to={to}
        activeProps={{ className: "text-foreground" }}
        inactiveProps={{ className: "text-foreground-muted" }}
        className="hover:text-foreground-hover"
      >
        {children}
      </Link>
    </li>
  );
}

export function MarketingHeaderActions({ children }: PropsWithChildren) {
  return (
    <div className="flex items-center gap-2">
      {children}
    </div>
  );
}
