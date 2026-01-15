"use client";

import type { FC, PropsWithChildren, ReactNode } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Home, Calendar, List, Settings } from "lucide-react";
import { cn } from "../utils/cn";

interface TopNavItemProps {
  href: string;
  segment: string | null;
  icon: ReactNode;
  children: string;
}

const TopNavItem: FC<TopNavItemProps> = ({ href, segment, icon, children }) => {
  const selectedSegment = useSelectedLayoutSegment();
  const isActive = selectedSegment === segment;

  return (
    <Link
      draggable={false}
      href={href}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs",
        isActive
          ? "text-foreground bg-surface-muted"
          : "text-foreground-muted hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </Link>
  );
};

const TopNav: FC<PropsWithChildren> = ({ children }) => {
  return (
    <nav className="flex items-center justify-between gap-px mb-8 -mx-2.5">
      {children}
    </nav>
  );
};

TopNav.displayName = "TopNav";
TopNavItem.displayName = "TopNavItem";

export { TopNav, TopNavItem };
export type { TopNavItemProps };
