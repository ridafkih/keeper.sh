"use client";

import { useState } from "react";
import { Button, ButtonText } from "../../../components/button";
import {
  ConnectionPreambleModalProvider,
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

const ConnectionPreambleDemo = () => {
  const [open, setOpen] = useState(false);

  const handleConnect = (accountId: string) => {
    console.log("Connecting to account:", accountId);
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ButtonText>Connect Account</ButtonText>
      </Button>
      <ConnectionPreambleModalProvider
        open={open}
        onClose={() => setOpen(false)}
        accounts={DEMO_ACCOUNTS}
        onConnect={handleConnect}
      />
    </>
  );
};

export { ConnectionPreambleDemo };
