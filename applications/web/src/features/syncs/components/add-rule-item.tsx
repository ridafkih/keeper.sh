import Plus from "lucide-react/dist/esm/icons/plus";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";

export interface AddRuleOption<TKind extends string> {
  kind: TKind;
  label: string;
}

interface AddRuleItemProps<TKind extends string> {
  label: string;
  options: AddRuleOption<TKind>[];
  disabled?: boolean;
  onAdd: (kind: TKind) => void;
}

/** A popover row offering the kinds of condition or action a rule can still take. */
export function AddRuleItem<TKind extends string>({ label, options, disabled, onAdd }: AddRuleItemProps<TKind>) {
  return (
    <NavigationMenuPopover
      disabled={disabled || options.length === 0}
      trigger={
        <>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
        </>
      }
    >
      {options.map((option) => (
        <AddRuleOptionItem key={option.kind} option={option} onAdd={onAdd} />
      ))}
    </NavigationMenuPopover>
  );
}

function AddRuleOptionItem<TKind extends string>({ option, onAdd }: { option: AddRuleOption<TKind>; onAdd: (kind: TKind) => void }) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem onClick={() => { onAdd(option.kind); close(); }}>
      <NavigationMenuItemLabel>{option.label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing />
    </NavigationMenuButtonItem>
  );
}
