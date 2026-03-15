import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Link } from "@tanstack/react-router";
import {
  NavigationMenuItem,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import { cn } from "@/utils/cn";

interface MetadataRowProps {
  label: string;
  value?: string;
  icon?: ReactNode;
  truncate?: boolean;
  to?: ComponentPropsWithoutRef<typeof Link>["to"];
}

export function MetadataRow({ label, value, icon, truncate = false, to }: MetadataRowProps) {
  const content = (
    <>
      <Text size="sm" tone="muted" className="shrink-0">{label}</Text>
      {value && (
        <div className={cn("ml-auto overflow-hidden", truncate && "min-w-0")}>
          <Text size="sm" tone="muted" className={cn(truncate && "truncate")}>{value}</Text>
        </div>
      )}
      {icon && <div className="ml-auto shrink-0"><NavigationMenuItemIcon>{icon}</NavigationMenuItemIcon></div>}
    </>
  );

  if (to) return <NavigationMenuLinkItem to={to}>{content}</NavigationMenuLinkItem>;
  return <NavigationMenuItem>{content}</NavigationMenuItem>;
}
