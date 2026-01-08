import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

export const showPasswordFieldAtom = atom(false);
export const isLoadingAtom = atom(false);

const useShowPasswordField = () => useAtomValue(showPasswordFieldAtom);
const useSetShowPasswordField = () => useSetAtom(showPasswordFieldAtom);

const useIsLoading = () => useAtomValue(isLoadingAtom);
const useSetIsLoading = () => useSetAtom(isLoadingAtom);

const AuthFormProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export {
  useShowPasswordField,
  useSetShowPasswordField,
  useIsLoading,
  useSetIsLoading,
  AuthFormProvider,
};
