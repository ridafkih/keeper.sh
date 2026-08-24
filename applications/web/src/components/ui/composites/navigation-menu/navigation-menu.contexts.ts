import { createContext, use, type ReactNode } from "react";
import type { MenuVariant } from "./navigation-menu.styles";

export const MenuVariantContext = createContext<MenuVariant>("default");
export const ItemIsLinkContext = createContext(false);
export const InsidePopoverContext = createContext(false);
export const ItemDisabledContext = createContext(false);

type PopoverContextValue = {
  expanded: boolean;
  toggle: () => void;
  close: () => void;
  triggerContent: ReactNode;
};

export const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopover() {
  const context = use(PopoverContext);
  if (!context) {
    throw new Error(
      "NavigationMenuPopover subcomponents must be used within NavigationMenuPopover",
    );
  }
  return context;
}
