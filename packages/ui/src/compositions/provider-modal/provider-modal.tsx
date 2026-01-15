"use client";

import type { FC } from "react";
import { useState } from "react";
import type { Provider, ProviderType } from "../../types/provider";
import { ProviderIcon } from "../../components/provider-icon";
import { ProviderDetails } from "../../components/provider-details";
import { Copy } from "../../components/copy";
import { List, ListItemButton, ListItemLabel } from "../../components/list";
import { Modal, ModalHeader } from "../modal/modal";
import { tv } from "tailwind-variants";

const layoutVariants = tv({
  slots: {
    content: "flex flex-col md:grid md:grid-cols-[2fr_3fr] md:grid-rows-[minmax(0,1fr)] overflow-auto md:overflow-hidden max-h-[60vh]",
    sidebar: "px-4 py-2 border-b md:border-b-0 md:border-r border-border md:overflow-auto",
    details: "grid grid-cols-1 grid-rows-1 md:overflow-auto",
  },
});

const { content, sidebar, details } = layoutVariants();

interface ProviderSelectionModalProps {
  type: ProviderType;
  open: boolean;
  onClose: () => void;
  providers: Provider[];
  title: string;
  onConnect: (providerId: string) => void;
}

const ProviderSelectionModal: FC<ProviderSelectionModalProps> = ({
  type,
  open,
  onClose,
  providers,
  title,
  onConnect,
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    providers[0]?.id ?? ""
  );

  const handleConnect = () => {
    onConnect(selectedProviderId);
    onClose();
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl overflow-hidden p-0">
      <div className="p-4 border-b border-border">
        <ModalHeader title={title} onClose={onClose} />
      </div>
      <div className={content()}>
        <div className={sidebar()}>
          <Copy className="text-xs mb-2">Select a provider</Copy>
          <List className="mx-2">
            {providers.map((provider) => (
              <ListItemButton
                key={provider.id}
                id={provider.id}
                onClick={() => handleSelectProvider(provider.id)}
                selected={selectedProviderId === provider.id}
              >
                <div className="flex items-center gap-2">
                  <ProviderIcon provider={provider} />
                  <ListItemLabel>{provider.name}</ListItemLabel>
                </div>
              </ListItemButton>
            ))}
          </List>
        </div>

        <div className={details()}>
          {providers
            .filter((p) => p.id === selectedProviderId)
            .map((provider) => (
              <ProviderDetails
                key={provider.id}
                provider={provider}
                onConnect={handleConnect}
              />
            ))}
        </div>
      </div>
    </Modal>
  );
};

ProviderSelectionModal.displayName = "ProviderSelectionModal";

export { ProviderSelectionModal };
export type { ProviderSelectionModalProps };
