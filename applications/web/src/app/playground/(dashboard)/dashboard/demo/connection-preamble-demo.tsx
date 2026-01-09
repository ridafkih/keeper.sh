"use client";

import { Button, ButtonText } from "../../../components/button";
import {
  ConnectionPreambleModalProvider,
  useSetModalOpen,
  type Account,
} from "../../../compositions/connection-preamble-modal/connection-preamble-modal";

const DEMO_ACCOUNTS: Account[] = [
  {
    id: "google-1",
    icon: "/integrations/icon-google.svg",
    name: "Google Calendar",
  },
  {
    id: "outlook-1",
    icon: "/integrations/icon-outlook.svg",
    name: "Outlook",
  },
  {
    id: "icloud-1",
    icon: "/integrations/icon-icloud.svg",
    name: "iCloud",
  },
  {
    id: "fastmail-1",
    icon: "/integrations/icon-fastmail.svg",
    name: "Fastmail",
  },
];

const OpenConnectionPreambleButton = () => {
  const setModalOpen = useSetModalOpen();

  return (
    <Button variant="outline" onClick={() => setModalOpen(true)}>
      <ButtonText>Connect Account</ButtonText>
    </Button>
  );
};

const ConnectionPreambleDemo = () => {
  const handleConnect = (accountId: string) => {
    console.log("Connecting to account:", accountId);
  };

  return (
    <ConnectionPreambleModalProvider accounts={DEMO_ACCOUNTS} onConnect={handleConnect}>
      <OpenConnectionPreambleButton />
    </ConnectionPreambleModalProvider>
  );
};

export { ConnectionPreambleDemo };
