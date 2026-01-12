"use client";

import type { FC } from "react";
import Image from "next/image";
import { AlertTriangle, ArrowDown, Check, RefreshCw } from "lucide-react";
import { Heading1, Heading2 } from "../../../components/heading";
import { List, ListItemLink, ListItemLabel, ListItemValue, ListItemAdd } from "../../../components/list";
import { Copy } from "@/app/playground/components/copy";

interface Source {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
  eventCount: number;
  status: "synced" | "syncing" | "error" | "reauth";
}

interface Destination {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
  eventsSynced: number;
  eventsTotal: number;
  status: "synced" | "syncing" | "error" | "reauth";
}

const MOCK_SOURCES: Source[] = [
  {
    id: "source-1",
    name: "Personal",
    email: "john@gmail.com",
    provider: {
      id: "google",
      name: "Google",
      icon: "/integrations/icon-google.svg",
    },
    eventCount: 142,
    status: "synced",
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
    eventCount: 89,
    status: "reauth",
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
    eventCount: 23,
    status: "syncing",
  },
];

const MOCK_DESTINATIONS: Destination[] = [
  {
    id: "dest-1",
    name: "Calendar",
    email: "john@outlook.com",
    provider: {
      id: "outlook",
      name: "Outlook",
      icon: "/integrations/icon-outlook.svg",
    },
    eventsSynced: 198,
    eventsTotal: 254,
    status: "syncing",
  },
  {
    id: "dest-2",
    name: "Keeper",
    email: "john@fastmail.com",
    provider: {
      id: "fastmail",
      name: "Fastmail",
      icon: "/integrations/icon-fastmail.svg",
    },
    eventsSynced: 254,
    eventsTotal: 254,
    status: "synced",
  },
];

const formatEventCount = (count: number): string => {
  if (count === 1) {
    return "1 event";
  }
  return `${count} events`;
};

const formatSyncProgress = (synced: number, total: number): string => {
  const percent = Math.round((synced / total) * 100);
  return `${percent}%`;
};

interface StatusIconProps {
  status: "synced" | "syncing" | "error" | "reauth";
}

const StatusIcon: FC<StatusIconProps> = ({ status }) => {
  if (status === "syncing") {
    return <RefreshCw size={14} className="text-neutral-400 animate-spin" />;
  }
  if (status === "synced") {
    return <Check size={14} className="text-neutral-400" />;
  }
  if (status === "reauth") {
    return <AlertTriangle size={14} className="text-amber-500" />;
  }
  return <div className="size-1 rounded-xl bg-red-500" />;
};

interface SourceItemProps {
  source: Source;
}

const SourceItem: FC<SourceItemProps> = ({ source }) => (
  <ListItemLink id={source.id} href={`/playground/dashboard/calendars/${source.id}`}>
    <div className="flex items-center gap-2">
      <Image
        src={source.provider.icon}
        alt={source.provider.name}
        width={14}
        height={14}
      />
      <ListItemLabel>{source.name}</ListItemLabel>
      <ListItemValue>{source.email}</ListItemValue>
    </div>
    <div className="flex items-center gap-3">
      <ListItemValue>{formatEventCount(source.eventCount)}</ListItemValue>
      <StatusIcon status={source.status} />
    </div>
  </ListItemLink>
);

interface DestinationItemProps {
  destination: Destination;
}

const DestinationItem: FC<DestinationItemProps> = ({ destination }) => (
  <ListItemLink id={destination.id} href={`/playground/dashboard/calendars/${destination.id}`}>
    <div className="flex items-center gap-2">
      <Image
        src={destination.provider.icon}
        alt={destination.provider.name}
        width={14}
        height={14}
      />
      <ListItemLabel>{destination.name}</ListItemLabel>
      <ListItemValue>{destination.email}</ListItemValue>
    </div>
    <div className="flex items-center gap-3">
      <ListItemValue>{formatSyncProgress(destination.eventsSynced, destination.eventsTotal)}</ListItemValue>
      <StatusIcon status={destination.status} />
    </div>
  </ListItemLink>
);

const CalendarsPage = () => (
  <div className="flex flex-col gap-8 pt-16 pb-8">
    <Heading1>Calendars</Heading1>

    <div className="flex flex-col gap-2">
      <Heading2>Sources</Heading2>
      <Copy className="text-xs">Calendars for which events may be sourced, these events are pooled and can be used to push events to destinations.</Copy>
      <List>
        {MOCK_SOURCES.map((source) => (
          <SourceItem key={source.id} source={source} />
        ))}
        <ListItemAdd>Add source</ListItemAdd>
      </List>
    </div>

    <ArrowDown size={20} className="text-neutral-300 mx-auto" />

    <div className="flex flex-col gap-2">
      <Heading2>Destinations</Heading2>
      <Copy className="text-xs">When events are pulled from sources, they can be pushed to destinations. Destinations require special permissions to write events to.</Copy>
      <List>
        {MOCK_DESTINATIONS.map((destination) => (
          <DestinationItem key={destination.id} destination={destination} />
        ))}
        <ListItemAdd>Add destination</ListItemAdd>
      </List>
    </div>
  </div>
);

export default CalendarsPage;
