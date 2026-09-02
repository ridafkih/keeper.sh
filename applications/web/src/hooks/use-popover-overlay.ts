import { useCallback, useId } from "react";
import { useSetAtom } from "jotai";
import { popoverOverlayOwnerAtom } from "@/state/popover-overlay";

/** Drop-in `setOverlay(active)` scoped to this component instance. */
export function useSetPopoverOverlay() {
  const owner = useId();
  const write = useSetAtom(popoverOverlayOwnerAtom);
  return useCallback((active: boolean) => write(owner, active), [write, owner]);
}
