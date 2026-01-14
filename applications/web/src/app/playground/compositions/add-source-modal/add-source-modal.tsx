"use client";

import type { FC } from "react";
import { useState } from "react";
import Image from "next/image";
import { tv } from "tailwind-variants";
import { cn } from "../../utils/cn";
import { Calendar, ExternalLink, Link2 } from "lucide-react";
import { Heading3 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { Button, ButtonText } from "../../components/button";
import { List, ListItemButton, ListItemLabel } from "../../components/list";
import { Modal, ModalHeader } from "../modal/modal";
import { useIsMobile } from "../../hooks/use-is-mobile";

interface ProviderStep {
  title: string;
  description: string;
}

interface Provider {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  steps: ProviderStep[];
  connectLabel: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "google",
    name: "Google Calendar",
    icon: "/integrations/icon-google.svg",
    description: "Connect your Google Calendar using secure OAuth authentication.",
    steps: [
      {
        title: "Sign in with Google",
        description: "Authenticate with your Google account.",
      },
      {
        title: "Grant calendar access",
        description: "Allow Keeper to read your calendar events.",
      },
    ],
    connectLabel: "Connect Google",
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: "/integrations/icon-outlook.svg",
    description: "Connect your Outlook or Microsoft 365 calendar using secure OAuth authentication.",
    steps: [
      {
        title: "Sign in with Microsoft",
        description: "Authenticate with your Microsoft account.",
      },
      {
        title: "Grant calendar access",
        description: "Allow Keeper to read your calendar events.",
      },
    ],
    connectLabel: "Connect Outlook",
  },
  {
    id: "icloud",
    name: "iCloud Calendar",
    icon: "/integrations/icon-icloud.svg",
    description: "Connect your iCloud Calendar using an app-specific password.",
    steps: [
      {
        title: "Generate an app-specific password",
        description: "Go to appleid.apple.com → Sign-In and Security → App-Specific Passwords.",
      },
      {
        title: "Enter your credentials",
        description: "Use your Apple ID email and the app-specific password you generated.",
      },
      {
        title: "Select calendars",
        description: "Choose which iCloud calendars you want to sync.",
      },
    ],
    connectLabel: "Connect iCloud",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    icon: "/integrations/icon-fastmail.svg",
    description: "Connect your Fastmail calendar using an app password.",
    steps: [
      {
        title: "Generate an app password",
        description: "Go to Fastmail Settings → Privacy & Security → App Passwords.",
      },
      {
        title: "Enter your credentials",
        description: "Use your Fastmail email and the app password you generated.",
      },
      {
        title: "Select calendars",
        description: "Choose which Fastmail calendars you want to sync.",
      },
    ],
    connectLabel: "Connect Fastmail",
  },
  {
    id: "caldav",
    name: "CalDAV",
    icon: null,
    description: "Connect any CalDAV-compatible calendar server.",
    steps: [
      {
        title: "Find your CalDAV URL",
        description: "Locate the CalDAV server URL from your calendar provider's settings.",
      },
      {
        title: "Enter server details",
        description: "Provide the CalDAV URL, your username, and password.",
      },
      {
        title: "Select calendars",
        description: "Choose which calendars from this server you want to sync.",
      },
    ],
    connectLabel: "Connect CalDAV",
  },
  {
    id: "ical",
    name: "iCal Link",
    icon: null,
    description: "Subscribe to any calendar using an iCal URL for read-only access.",
    steps: [
      {
        title: "Get the iCal URL",
        description: "Find the iCal or ICS subscription link from your calendar provider.",
      },
      {
        title: "Paste the URL",
        description: "Enter the iCal URL to subscribe to the calendar.",
      },
    ],
    connectLabel: "Add iCal Link",
  },
];

const modalLayoutVariants = tv({
  slots: {
    content: "",
    sidebar: "px-4 py-2",
    details: "grid grid-cols-1 grid-rows-1",
  },
  variants: {
    isMobile: {
      true: {
        content: "flex flex-col overflow-auto max-h-[60vh]",
        sidebar: "border-b border-neutral-100",
        details: "",
      },
      false: {
        content: "grid grid-cols-[2fr_3fr] grid-rows-[minmax(0,1fr)] max-h-[60vh] overflow-hidden",
        sidebar: "border-r border-neutral-100 overflow-auto",
        details: "overflow-auto",
      },
    },
  },
  defaultVariants: {
    isMobile: false,
  },
});

const providerDetailsVariants = tv({
  base: "col-start-1 row-start-1",
  variants: {
    selected: {
      true: "",
      false: "invisible",
    },
  },
  defaultVariants: {
    selected: false,
  },
});

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
}

interface ProviderIconProps {
  provider: Provider;
}

const ProviderIcon: FC<ProviderIconProps> = ({ provider }) => {
  if (provider.icon) {
    return (
      <Image
        src={provider.icon}
        alt={provider.name}
        width={16}
        height={16}
      />
    );
  }
  if (provider.id === "ical") {
    return <Link2 size={16} className="text-neutral-400" />;
  }
  return <Calendar size={16} className="text-neutral-400" />;
};

interface ProviderDetailsProps {
  provider: Provider;
  onConnect: () => void;
  className?: string;
}

const ProviderDetails: FC<ProviderDetailsProps> = ({ provider, onConnect, className }) => (
  <div className={cn("flex flex-col justify-between gap-12 h-full p-4 pt-2", className)}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={provider} />
          <Heading3>{provider.name}</Heading3>
        </div>
        <Copy className="text-xs">{provider.description}</Copy>
      </div>

      <div className="flex flex-col gap-3">
        {provider.steps.map((step, index) => (
          <div key={step.title} className="flex gap-3">
            <div className="flex items-center justify-center size-5 shrink-0 rounded-full bg-neutral-100 text-xs font-medium text-neutral-600">
              {index + 1}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-neutral-900">{step.title}</span>
              <span className="text-xs text-neutral-500">{step.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>

    <Button className="w-full" onClick={onConnect}>
      <ButtonText>{provider.connectLabel}</ButtonText>
      <ExternalLink size={14} />
    </Button>
  </div>
);

const AddSourceModal: FC<AddSourceModalProps> = ({ open, onClose }) => {
  const isMobile = useIsMobile();
  const [selectedProviderId, setSelectedProviderId] = useState<string>(PROVIDERS[0]?.id ?? "");
  const layoutStyles = modalLayoutVariants({ isMobile });

  const handleConnect = () => {
    // TODO: Handle provider connection
    onClose();
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl overflow-hidden p-0">
      <div className="p-4 border-b border-neutral-100">
        <ModalHeader title="Add source" onClose={onClose} />
      </div>
      <div className={layoutStyles.content()}>
        <div className={layoutStyles.sidebar()}>
          <Copy className="text-xs mb-2">Select a provider</Copy>
          <List className="mx-2">
            {PROVIDERS.map((provider) => (
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

        <div className={layoutStyles.details()}>
          {PROVIDERS.map((provider) => (
            <ProviderDetails
              key={provider.id}
              provider={provider}
              onConnect={handleConnect}
              className={providerDetailsVariants({ selected: selectedProviderId === provider.id })}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
};

export { AddSourceModal };
