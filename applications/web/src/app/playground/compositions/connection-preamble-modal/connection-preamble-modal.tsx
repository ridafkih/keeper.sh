import type { FC, PropsWithChildren } from "react";
import { ModalProvider, useSetModalOpen } from "../modal/modal-context";
import { ConnectionPreambleProvider, type Account } from "./contexts/connection-preamble-context";
import { ConnectionPreambleModal as ConnectionPreambleModalSansProviders } from "./components/connection-preamble-modal";

interface ConnectionPreambleModalProps {
  accounts: Account[];
  onConnect?: (accountId: string) => void;
}

const ConnectionPreambleModalProvider: FC<PropsWithChildren<ConnectionPreambleModalProps>> = ({
  children,
  ...props
}) => (
  <ModalProvider>
    <ConnectionPreambleProvider>
      {children}
      <ConnectionPreambleModalSansProviders {...props} />
    </ConnectionPreambleProvider>
  </ModalProvider>
);

export { ConnectionPreambleModalProvider, useSetModalOpen };
export type { Account };
