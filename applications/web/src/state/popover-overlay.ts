import { atom } from "jotai";

const overlayOwnersAtom = atom<ReadonlySet<string>>(new Set<string>());

/** True while any owner holds the overlay open. */
export const popoverOverlayAtom = atom((get) => get(overlayOwnersAtom).size > 0);

/** Owner-scoped writes: one popover closing can't drop the blur another still holds. */
export const popoverOverlayOwnerAtom = atom(
  null,
  (get, set, owner: string, active: boolean) => {
    const owners = get(overlayOwnersAtom);
    if (owners.has(owner) === active) return;
    const next = new Set(owners);
    if (active) next.add(owner);
    else next.delete(owner);
    set(overlayOwnersAtom, next);
  },
);
