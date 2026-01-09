"use client";

import type { FC } from "react";
import { AccountListItem } from "./account-list-item";
import {
  useAccounts,
  useSelectedAccountId,
  useSetSelectedAccountId,
} from "../contexts/connection-preamble-context";

const AccountList: FC = () => {
  const accounts = useAccounts();
  const selectedId = useSelectedAccountId();
  const setSelectedId = useSetSelectedAccountId();

  return (
    <div className="flex flex-col gap-1">
      {accounts.map((account) => (
        <AccountListItem
          key={account.id}
          icon={account.icon}
          name={account.name}
          selected={selectedId === account.id}
          onSelect={() => setSelectedId(account.id)}
        />
      ))}
    </div>
  );
};

export { AccountList };
