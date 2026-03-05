import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Link } from "@tanstack/react-router";
import { NavigationMenuItem, NavigationMenuItemIcon } from "../ui/navigation-menu";
import { Text } from "../ui/text";

interface MetadataRowProps {
  label: string;
  value?: string;
  icon?: ReactNode;
  truncate?: boolean;
  to?: ComponentPropsWithoutRef<typeof Link>["to"];
}

function renderValue(value: string, truncate: boolean) {
  if (truncate) {
    return (
      <div className="min-w-0">
        <Text size="sm" tone="muted" className="truncate">{value}</Text>
      </div>
    );
  }
  return <Text size="sm" tone="muted">{value}</Text>;
}

export function MetadataRow({ label, value, icon, truncate = false, to }: MetadataRowProps) {
  return (
    <NavigationMenuItem to={to}>
      <Text size="sm" tone="muted" className="shrink-0">{label}</Text>
      {value && (
        <div className="ml-auto overflow-hidden">
          {renderValue(value, truncate)}
        </div>
      )}
      {icon && <div className="ml-auto shrink-0"><NavigationMenuItemIcon>{icon}</NavigationMenuItemIcon></div>}
    </NavigationMenuItem>
  );
}
