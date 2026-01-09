import type { FC, PropsWithChildren } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { createContext, useContext } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";
import { DEFAULT_ROW_HEIGHT, GAP } from "../utils/constants";

// Base atoms
const rowHeightAtom = atom(DEFAULT_ROW_HEIGHT);
const scrollOffsetAtom = atom(0);
const scrollDirectionAtom = atom<"up" | "down">("down");

// Derived atom - firstVisibleRowIndex calculated from scroll offset and row height
const firstVisibleRowIndexAtom = atom((get) => {
  const scrollOffset = get(scrollOffsetAtom);
  const rowHeight = get(rowHeightAtom);
  return Math.floor(scrollOffset / (rowHeight + GAP));
});

// Hooks for rowHeight
const useRowHeight = () => useAtomValue(rowHeightAtom);
const useSetRowHeight = () => useSetAtom(rowHeightAtom);

// Hooks for scroll offset
const useScrollOffset = () => useAtomValue(scrollOffsetAtom);
const useSetScrollOffset = () => useSetAtom(scrollOffsetAtom);

// Hooks for scroll direction
const useScrollDirection = () => useAtomValue(scrollDirectionAtom);
const useSetScrollDirection = () => useSetAtom(scrollDirectionAtom);

// Hook for firstVisibleRowIndex (read-only, derived)
const useFirstVisibleRowIndex = () => useAtomValue(firstVisibleRowIndexAtom);

// Virtualizer context
type VirtualizerInstance = Virtualizer<HTMLDivElement, Element>;
const VirtualizerContext = createContext<VirtualizerInstance | null>(null);

const useCalendarVirtualizer = () => {
  const virtualizer = useContext(VirtualizerContext);
  if (!virtualizer) throw new Error("useCalendarVirtualizer must be used within VirtualizerProvider");
  return virtualizer;
};

const VirtualizerProvider: FC<PropsWithChildren<{ virtualizer: VirtualizerInstance }>> = ({
  children,
  virtualizer,
}) => (
  <VirtualizerContext.Provider value={virtualizer}>
    {children}
  </VirtualizerContext.Provider>
);

const CalendarGridProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export {
  CalendarGridProvider,
  VirtualizerProvider,
  useRowHeight,
  useSetRowHeight,
  useScrollOffset,
  useSetScrollOffset,
  useScrollDirection,
  useSetScrollDirection,
  useFirstVisibleRowIndex,
  useCalendarVirtualizer,
};
