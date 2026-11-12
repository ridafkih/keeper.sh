import { use, type PropsWithChildren } from "react";
import {
  InsidePopoverContext,
  ItemDisabledContext,
  ItemIsLinkContext,
  MenuVariantContext,
} from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { navigationMenuItemStyle } from "@/components/ui/composites/navigation-menu/navigation-menu.styles";

interface SelectableItemProps {
  role: "radio" | "checkbox";
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onSelect: () => void;
}

/** A menu row that says whether it's picked, for lists whose check icon alone would be silent to a screen reader. */
export function SelectableItem({ role, checked, disabled, className, onSelect, children }: PropsWithChildren<SelectableItemProps>) {
  const variant = use(MenuVariantContext);
  const insidePopover = use(InsidePopoverContext);
  const Wrapper = insidePopover ? "div" : "li";

  return (
    <Wrapper>
      <ItemDisabledContext value={Boolean(disabled)}>
        <button
          type="button"
          role={role}
          aria-checked={checked}
          disabled={disabled}
          onClick={onSelect}
          className={navigationMenuItemStyle({ variant, interactive: !disabled, className })}
        >
          <ItemIsLinkContext value={false}>{children}</ItemIsLinkContext>
        </button>
      </ItemDisabledContext>
    </Wrapper>
  );
}
