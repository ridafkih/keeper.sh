import CheckIcon from "lucide-react/dist/esm/icons/check";
import {
  NavigationMenuButtonItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { Text } from "@/components/ui/primitives/text";

interface OverrideChoiceItemProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  keepOpen?: boolean;
}

export function OverrideChoiceItem({ label, selected, onSelect, keepOpen = false }: OverrideChoiceItemProps) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem
      onClick={() => {
        onSelect();
        if (!keepOpen) close();
      }}
    >
      <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {selected && <CheckIcon size={14} />}
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

interface OverrideTriggerProps {
  label: string;
  value: string;
  inherited: boolean;
  locked: boolean;
}

export function OverrideTrigger({ label, value, inherited, locked }: OverrideTriggerProps) {
  return (
    <>
      <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        <OverrideValue value={value} inherited={inherited} locked={locked} />
      </NavigationMenuItemTrailing>
    </>
  );
}

function resolveValueTone(inherited: boolean, locked: boolean): "disabled" | "muted" | "default" {
  if (locked) return "disabled";
  if (inherited) return "muted";
  return "default";
}

function OverrideValue({ value, inherited, locked }: Omit<OverrideTriggerProps, "label">) {
  return (
    <Text size="sm" tone={resolveValueTone(inherited, locked)} className="min-w-0 truncate">
      {value}
    </Text>
  );
}
