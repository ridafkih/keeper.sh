"use client";

import type { FC } from "react";
import { Button, ButtonText } from "../../../components/button";
import { useSelectedAccountId } from "../contexts/connection-preamble-context";

interface ConnectButtonProps {
  onConnect?: (accountId: string) => void;
}

const ConnectButton: FC<ConnectButtonProps> = ({ onConnect }) => {
  const selectedId = useSelectedAccountId();

  const handleClick = () => {
    if (selectedId && onConnect) {
      onConnect(selectedId);
    }
  };

  return (
    <Button
      variant="primary"
      size="large"
      className="w-full"
      disabled={!selectedId}
      onClick={handleClick}
    >
      <ButtonText>Connect</ButtonText>
    </Button>
  );
};

export { ConnectButton };
