"use client";

import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

export const showPasswordFieldAtom = atom(false);

const useShowPasswordField = () => useAtomValue(showPasswordFieldAtom);
const useSetShowPasswordField = () => useSetAtom(showPasswordFieldAtom);

const AuthFormProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export { useShowPasswordField, useSetShowPasswordField, AuthFormProvider };
