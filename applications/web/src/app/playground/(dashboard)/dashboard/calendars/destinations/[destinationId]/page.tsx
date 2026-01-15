"use client";

import type { FC } from "react";
import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  Copy,
  Heading1,
  Heading2,
  Button,
  ButtonText,
  Modal,
  ModalHeader,
  ModalFooter,
  List,
  Notice
} from "@keeper.sh/ui";
import { CalendarCheckboxItem } from "../../components/calendar-checkbox-item";

interface Source {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
  enabled: boolean;
}

interface DestinationDetail {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
  status: "synced" | "syncing" | "error" | "reauthenticate";
  sources: Source[];
  syncStatus: {
    status: "idle" | "syncing" | "error";
    eventsSynced: number;
    localEvents: number;
    lastSyncedAt: string | null;
    error?: string;
  };
}

const MOCK_DESTINATIONS: Record<string, DestinationDetail> = {
  "dest-1": {
    id: "dest-1",
    name: "Calendar",
    email: "john@outlook.com",
    provider: {
      id: "outlook",
      name: "Outlook",
      icon: "/integrations/icon-outlook.svg",
    },
    status: "syncing",
    sources: [
      {
        id: "source-1",
        name: "Personal",
        email: "john@gmail.com",
        provider: {
          id: "google",
          name: "Google",
          icon: "/integrations/icon-google.svg",
        },
        enabled: true,
      },
      {
        id: "source-2",
        name: "Work",
        email: "john@company.com",
        provider: {
          id: "google",
          name: "Google",
          icon: "/integrations/icon-google.svg",
        },
        enabled: true,
      },
      {
        id: "source-3",
        name: "Family",
        email: "john@icloud.com",
        provider: {
          id: "icloud",
          name: "iCloud",
          icon: "/integrations/icon-icloud.svg",
        },
        enabled: false,
      },
    ],
    syncStatus: {
      status: "syncing",
      eventsSynced: 198,
      localEvents: 254,
      lastSyncedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
  },
  "dest-2": {
    id: "dest-2",
    name: "Keeper",
    email: "john@fastmail.com",
    provider: {
      id: "fastmail",
      name: "Fastmail",
      icon: "/integrations/icon-fastmail.svg",
    },
    status: "synced",
    sources: [
      {
        id: "source-1",
        name: "Personal",
        email: "john@gmail.com",
        provider: {
          id: "google",
          name: "Google",
          icon: "/integrations/icon-google.svg",
        },
        enabled: true,
      },
      {
        id: "source-2",
        name: "Work",
        email: "john@company.com",
        provider: {
          id: "google",
          name: "Google",
          icon: "/integrations/icon-google.svg",
        },
        enabled: false,
      },
      {
        id: "source-3",
        name: "Family",
        email: "john@icloud.com",
        provider: {
          id: "icloud",
          name: "iCloud",
          icon: "/integrations/icon-icloud.svg",
        },
        enabled: true,
      },
    ],
    syncStatus: {
      status: "idle",
      eventsSynced: 254,
      localEvents: 254,
      lastSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  },
};

interface DestinationDetailPageProps {
  params: Promise<{ destinationId: string }>;
}

const DestinationDetailPage: FC<DestinationDetailPageProps> = ({ params }) => {
  const { destinationId } = use(params);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  const destination = MOCK_DESTINATIONS[destinationId];
  const [sources, setSources] = useState(destination?.sources || []);

  const handleToggleSource = (sourceId: string) => {
    setSources((prev) =>
      prev.map((source) =>
        source.id === sourceId ? { ...source, enabled: !source.enabled } : source
      )
    );
  };

  if (!destination) {
    return (
      <div className="flex flex-col gap-8">
        <Copy className="text-xs">The destination you're looking for doesn't exist.</Copy>
        <Link
          href="/playground/dashboard/calendars"
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft size={12} />
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Heading1>{destination.name}</Heading1>
        <div className="flex items-center gap-2">
          <Link
            href="/playground/dashboard/calendars"
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
          >
            <ArrowLeft size={12} />
            Back
          </Link>
          <span className="text-xs text-neutral-400">·</span>
          <span className="text-xs text-neutral-500">Destination</span>
          <span className="text-xs text-neutral-400">·</span>
          <div className="flex items-center gap-1">
            <Image src={destination.provider.icon} alt={destination.provider.name} width={12} height={12} />
            <Copy as="span" className="text-xs text-neutral-500">{destination.email}</Copy>
          </div>
        </div>
      </div>

      {destination.status === "reauthenticate" && (
        <Notice
          variant="warning"
          title="Reauthentication required"
          description="Your session has expired. Please reauthenticate to continue syncing events to this destination."
          action={{
            label: "Reauthenticate",
            onAction: () => {
              // Mock reauthentication
            },
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <Heading2>Sources</Heading2>
        <Copy className="text-xs">Select which sources to sync events from to this destination.</Copy>
        <List>
          {sources.map((source) => (
            <CalendarCheckboxItem
              key={source.id}
              id={source.id}
              name={source.name}
              email={source.email}
              providerIcon={source.provider.icon}
              providerName={source.provider.name}
              checked={source.enabled}
              onChange={() => handleToggleSource(source.id)}
            />
          ))}
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <Heading2>Danger Zone</Heading2>
        <Copy className="text-xs">Disconnect this destination. Synced events will remain on the calendar.</Copy>
        <Button
          variant="outline"
          className="text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setDisconnectModalOpen(true)}
        >
          <Trash2 size={14} />
          <ButtonText>Disconnect Destination</ButtonText>
        </Button>
      </div>

      <Modal open={disconnectModalOpen} onClose={() => setDisconnectModalOpen(false)}>
        <ModalHeader
          title="Disconnect destination"
          description={`Are you sure you want to disconnect "${destination.name}"? Synced events will remain on ${destination.provider.name}.`}
          onClose={() => setDisconnectModalOpen(false)}
        />
        <ModalFooter
          onCancel={() => setDisconnectModalOpen(false)}
          onConfirm={() => setDisconnectModalOpen(false)}
          confirmText="Disconnect"
          variant="danger"
        />
      </Modal>
    </div>
  );
};

export default DestinationDetailPage;
