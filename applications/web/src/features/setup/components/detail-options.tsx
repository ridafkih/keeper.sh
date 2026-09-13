import CheckIcon from "lucide-react/dist/esm/icons/check";
import Lock from "lucide-react/dist/esm/icons/lock";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import type { DetailChoice } from "../setup-draft";
import { DETAIL_LABELS, DETAIL_ORDER } from "../detail-labels";

interface DetailOptionsProps {
  selected: DetailChoice;
  locked: boolean;
  onSelect: (detail: DetailChoice) => void;
}

export function DetailOptions({ selected, locked, onSelect }: DetailOptionsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <NavigationMenu>
        {DETAIL_ORDER.map((detail) => {
          const disabled = locked && detail !== "calendar_name";
          return (
            <NavigationMenuButtonItem key={detail} disabled={disabled} onClick={() => onSelect(detail)}>
              <NavigationMenuItemLabel>{DETAIL_LABELS[detail]}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing>
                {disabled && <Lock size={14} className="text-foreground-disabled" />}
                {!disabled && detail === selected && <CheckIcon size={14} />}
              </NavigationMenuItemTrailing>
            </NavigationMenuButtonItem>
          );
        })}
      </NavigationMenu>
      {locked && <PremiumHint>Custom event titles are a Pro feature.</PremiumHint>}
    </div>
  );
}
