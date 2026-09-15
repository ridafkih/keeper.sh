import { use, type ReactNode } from "react";
import { MenuVariantContext } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { navigationMenuItemStyle } from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import { NavigationMenuItemLabel } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";

interface RuleRowProps {
  label: string;
  value?: string;
  trailing?: ReactNode;
}

/** A read-only menu row whose controls sit beside it rather than inside it. */
export function RuleRow({ label, value, trailing }: RuleRowProps) {
  const variant = use(MenuVariantContext);

  return (
    <li className="flex items-center">
      <div className={navigationMenuItemStyle({ variant, interactive: false, className: "min-w-0 flex-1" })}>
        <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>
        {value && <Text size="sm" tone="muted" className="min-w-0 flex-1 truncate text-right">{value}</Text>}
      </div>
      {trailing}
    </li>
  );
}
