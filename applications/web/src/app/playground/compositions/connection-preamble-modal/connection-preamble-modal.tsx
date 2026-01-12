import type { FC, PropsWithChildren } from "react";
import { ConnectionPreambleProvider, type Account } from "./contexts/connection-preamble-context";
import { ConnectionPreambleModal as ConnectionPreambleModalSansProviders } from "./components/connection-preamble-modal";

interface ConnectionPreambleModalProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  onConnect?: (accountId: string) => void;
}

const ConnectionPreambleModalProvider: FC<PropsWithChildren<ConnectionPreambleModalProps>> = ({
  children,
  ...props
}) => (
  <ConnectionPreambleProvider>
    {children}
    <ConnectionPreambleModalSansProviders {...props} />
  </ConnectionPreambleProvider>
);

export { ConnectionPreambleModalProvider };
export type { Account };
