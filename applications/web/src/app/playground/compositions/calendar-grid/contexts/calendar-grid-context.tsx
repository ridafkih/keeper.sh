import type { FC, PropsWithChildren } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { createContext, useContext } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

const rowHeightAtom = atom(100);

const useRowHeight = () => useAtomValue(rowHeightAtom);
const useSetRowHeight = () => useSetAtom(rowHeightAtom);

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
  useCalendarVirtualizer,
};
