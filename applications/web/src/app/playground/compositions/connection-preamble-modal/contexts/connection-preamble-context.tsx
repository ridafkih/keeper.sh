import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

interface Account {
  id: string;
  icon: string;
  name: string;
}

const accountsAtom = atom<Account[]>([]);
const selectedAccountIdAtom = atom<string | null>(null);

const useAccounts = () => useAtomValue(accountsAtom);
const useSetAccounts = () => useSetAtom(accountsAtom);

const useSelectedAccountId = () => useAtomValue(selectedAccountIdAtom);
const useSetSelectedAccountId = () => useSetAtom(selectedAccountIdAtom);

const ConnectionPreambleProvider: FC<PropsWithChildren> = ({ children }) => (
  <Provider>{children}</Provider>
);

export {
  ConnectionPreambleProvider,
  useAccounts,
  useSetAccounts,
  useSelectedAccountId,
  useSetSelectedAccountId,
};
export type { Account };
