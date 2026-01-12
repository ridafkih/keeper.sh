import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

const showPasswordFieldAtom = atom(false);
const isLoadingAtom = atom(false);

const useShowPasswordField = () => useAtomValue(showPasswordFieldAtom);
const useSetShowPasswordField = () => useSetAtom(showPasswordFieldAtom);

const useIsLoading = () => useAtomValue(isLoadingAtom);
const useSetIsLoading = () => useSetAtom(isLoadingAtom);

const AuthFormProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export {
  showPasswordFieldAtom,
  useShowPasswordField,
  useSetShowPasswordField,
  useIsLoading,
  useSetIsLoading,
  AuthFormProvider,
};
