import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import {
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { pairPagePath, type CalendarPair } from "../rules";

function PairRowContent({ pair }: { pair: CalendarPair }) {
  return (
    <>
      <NavigationMenuItemIcon>
        <ProviderIcon provider={pair.source.provider} calendarType={pair.source.calendarType} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel className="shrink-0 max-w-[36%]">{pair.source.name}</NavigationMenuItemLabel>
      <ArrowRight size={14} className="shrink-0 text-emerald-500" />
      <NavigationMenuItemIcon>
        <ProviderIcon provider={pair.destination.provider} calendarType={pair.destination.calendarType} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{pair.destination.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing />
    </>
  );
}

export function PairRow({ pair }: { pair: CalendarPair }) {
  return (
    <NavigationMenuLinkItem to={pairPagePath(pair.source.id, pair.destination.id)}>
      <PairRowContent pair={pair} />
    </NavigationMenuLinkItem>
  );
}

export function PairButtonRow({ pair, onClick }: { pair: CalendarPair; onClick: () => void }) {
  return (
    <NavigationMenuButtonItem onClick={onClick}>
      <PairRowContent pair={pair} />
    </NavigationMenuButtonItem>
  );
}
