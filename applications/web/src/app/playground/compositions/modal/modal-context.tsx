import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

const modalOpenAtom = atom(false);

const useModalOpen = () => useAtomValue(modalOpenAtom);
const useSetModalOpen = () => useSetAtom(modalOpenAtom);

const ModalProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export { useModalOpen, useSetModalOpen, ModalProvider };
