import type { PropsWithChildren } from "react";

export function MarketingFooter({ children }: PropsWithChildren) {
  return (
    <footer className="flex justify-between items-start gap-4 py-12 tracking-tight font-light text-sm z-20 bg-background">
      {children}
    </footer>
  );
}

export function MarketingFooterTagline({ children }: PropsWithChildren) {
  return (
    <p className="text-foreground-muted">
      {children}
    </p>
  );
}

export function MarketingFooterNav({ children }: PropsWithChildren) {
  return (
    <nav className="flex gap-6">
      {children}
    </nav>
  );
}

export function MarketingFooterNavGroup({ children }: PropsWithChildren) {
  return (
    <ul className="flex flex-col gap-2 w-fit list-none">
      {children}
    </ul>
  );
}

export function MarketingFooterNavGroupLabel({ children }: PropsWithChildren) {
  return (
    <li className="text-foreground">
      {children}
    </li>
  );
}

export function MarketingFooterNavItem({ children }: PropsWithChildren) {
  return (
    <li className="text-foreground-muted hover:text-foreground-hover cursor-pointer">
      {children}
    </li>
  );
}
