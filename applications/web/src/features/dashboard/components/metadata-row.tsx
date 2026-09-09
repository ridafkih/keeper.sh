import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import type { Link } from "@tanstack/react-router";
import {
  NavigationMenuItem,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import { cn } from "@/utils/cn";

interface MetadataRowProps {
  label: string;
  value?: string;
  /** Tones the whole row — label, value and arrow — for a row that reports a status. */
  tone?: ComponentPropsWithoutRef<typeof Text>["tone"];
  icon?: ReactNode;
  truncate?: boolean;
  to?: ComponentPropsWithoutRef<typeof Link>["to"];
}

export function MetadataRow({ label, value, tone, icon, truncate = false, to }: MetadataRowProps) {
  const content = (
    <>
      <Text size="sm" tone={tone ?? "muted"} className="shrink-0">{label}</Text>
      {value && (
        <div className={cn("ml-auto overflow-hidden", truncate && "min-w-0")}>
          <Text size="sm" tone={tone ?? "muted"} className={cn(truncate && "truncate")}>{value}</Text>
        </div>
      )}
      {icon && <div className="ml-auto shrink-0"><NavigationMenuItemIcon>{icon}</NavigationMenuItemIcon></div>}
    </>
  );

  // A linked row ends on the menu's arrow, so it reads as somewhere to go rather than a fact.
  if (to) {
    return (
      <NavigationMenuLinkItem to={to}>
        {content}
        <NavigationMenuItemTrailing
          className="grow-0"
          indicator={
            tone === "attention"
              ? <ArrowRight size={15} className="shrink-0 text-attention" />
              : undefined
          }
        />
      </NavigationMenuLinkItem>
    );
  }

  return <NavigationMenuItem>{content}</NavigationMenuItem>;
}
