"use client";

import type { FC } from "react";
import { useEffect } from "react";
import { Modal } from "../../modal/modal";
import { AccountList } from "./account-list";
import { ConnectButton } from "./connect-button";
import { Copy } from "../../../components/copy";
import { Heading3 } from "../../../components/heading";
import {
  useSetAccounts,
  useSetSelectedAccountId,
  type Account,
} from "../contexts/connection-preamble-context";

interface ConnectionPreambleModalProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  onConnect?: (accountId: string) => void;
}

const ConnectionPreambleModal: FC<ConnectionPreambleModalProps> = ({
  open,
  onClose,
  accounts,
  onConnect,
}) => {
  const setAccounts = useSetAccounts();
  const setSelectedAccountId = useSetSelectedAccountId();

  useEffect(() => {
    setAccounts(accounts);
    setSelectedAccountId(null);
  }, [accounts, setAccounts, setSelectedAccountId]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col justify-between h-full gap-3">
        <div className="flex flex-col gap-3">
          <Heading3>Connect Account</Heading3>
          <Copy>Select which account you would like to link to Keeper.</Copy>
          <AccountList />
        </div>
        <ConnectButton onConnect={onConnect} />
      </div>
    </Modal>
  );
};

export { ConnectionPreambleModal };
