import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import {
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import type { CalendarSource } from "@/types/api";
import type { SyncPairSummary } from "../sync-pairs";

interface SyncPairRowProps {
  pair: SyncPairSummary;
  source: CalendarSource;
}

export function SyncPairRow({ pair, source }: SyncPairRowProps) {
  return (
    <NavigationMenuLinkItem to={`/dashboard/accounts/${source.accountId}/${source.id}`}>
      <NavigationMenuItemIcon>
        <ArrowLeftRight size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{pair.label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {pair.busyOnly && <Text size="sm" tone="muted" className="shrink-0">Busy only</Text>}
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  );
}
