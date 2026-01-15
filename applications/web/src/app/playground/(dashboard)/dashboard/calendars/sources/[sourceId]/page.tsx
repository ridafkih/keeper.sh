"use client";

import type { FC } from "react";
import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  Heading1,
  Heading2,
  Copy,
  Button,
  ButtonText,
  Input,
  Modal,
  ModalHeader,
  ModalFooter,
  List,
  ListItemCheckbox,
  ListItemLabel,
  Notice
} from "@keeper.sh/ui";
import { CalendarCheckboxItem } from "../../components/calendar-checkbox-item";

interface SubCalendar {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
}

interface DestinationOption {
  id: string;
  name: string;
  email: string;
  provider: {
    icon: string;
    name: string;
  };
  enabled: boolean;
}

interface SyncSettings {
  summaries: boolean;
  descriptions: boolean;
  locations: boolean;
}

type SourceStatus = "synced" | "syncing" | "error" | "reauthenticate";

interface SourceDetail {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
  status: SourceStatus;
  subCalendars: SubCalendar[];
  destinations: DestinationOption[];
  syncSettings: SyncSettings;
}

const MOCK_SOURCE: SourceDetail = {
  id: "source-1",
  name: "Personal",
  email: "john@gmail.com",
  provider: {
    id: "google",
    name: "Google",
    icon: "/integrations/icon-google.svg",
  },
  status: "reauthenticate",
  subCalendars: [
    { id: "cal-1", name: "Personal", color: "#4285F4", enabled: true },
    { id: "cal-2", name: "Work", color: "#34A853", enabled: true },
    { id: "cal-3", name: "Birthdays", color: "#EA4335", enabled: false },
    { id: "cal-4", name: "Holidays", color: "#FBBC05", enabled: true },
  ],
  destinations: [
    {
      id: "dest-1",
      name: "Calendar",
      email: "john@outlook.com",
      provider: { icon: "/integrations/icon-outlook.svg", name: "Outlook" },
      enabled: true,
    },
    {
      id: "dest-2",
      name: "Keeper",
      email: "john@fastmail.com",
      provider: { icon: "/integrations/icon-fastmail.svg", name: "Fastmail" },
      enabled: false,
    },
  ],
  syncSettings: {
    summaries: true,
    descriptions: true,
    locations: false,
  },
};

interface SubCalendarItemProps {
  calendar: SubCalendar;
}

const SubCalendarItem: FC<SubCalendarItemProps> = ({ calendar }) => (
  <ListItemCheckbox id={calendar.id} defaultChecked={calendar.enabled}>
    <div className="flex items-center gap-2">
      <div className="size-1 rounded-xl" style={{ backgroundColor: calendar.color }} />
      <ListItemLabel>{calendar.name}</ListItemLabel>
    </div>
  </ListItemCheckbox>
);


interface CalendarDetailPageProps {
  params: Promise<{ sourceId: string }>;
}

const CalendarDetailPage: FC<CalendarDetailPageProps> = ({ params }) => {
  const { sourceId: _sourceId } = use(params);
  const source = MOCK_SOURCE;

  const [destinations, setDestinations] = useState(source.destinations);
  const [syncSummaries, setSyncSummaries] = useState(source.syncSettings.summaries);
  const [customSummary, setCustomSummary] = useState(source.name);

  const [syncDescriptions, setSyncDescriptions] = useState(source.syncSettings.descriptions);
  const [customDescription, setCustomDescription] = useState("");

  const [deleteSourceOpen, setDeleteSourceOpen] = useState(false);

  const handleToggleDestination = (destinationId: string) => {
    setDestinations((prev) =>
      prev.map((dest) =>
        dest.id === destinationId ? { ...dest, enabled: !dest.enabled } : dest
      )
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Heading1>{source.name}</Heading1>
        <div className="flex items-center gap-2">
          <Link
            href="/playground/dashboard/calendars"
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
          >
            <ArrowLeft size={12} />
            Back
          </Link>
          <span className="text-xs text-neutral-400">·</span>
          <span className="text-xs text-neutral-500">Source</span>
          <span className="text-xs text-neutral-400">·</span>
          <div className="flex items-center gap-1">
            <Image
              src={source.provider.icon}
              alt={source.provider.name}
              width={12}
              height={12}
            />
            <Copy as="span" className="text-xs text-neutral-500">{source.email}</Copy>
          </div>
        </div>
      </div>

      {source.status === "reauthenticate" && (
        <Notice
          variant="warning"
          title="Reauthentication required"
          description="Your session has expired. Please reauthenticate to continue syncing events from this calendar."
          action={{
            label: "Reauthenticate",
            onAction: () => {
              // TODO: Handle reauthentication
            },
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <Heading2>Calendars</Heading2>
        <Copy className="text-xs">Select which calendars to pull events from.</Copy>
        <List>
          {source.subCalendars.map((calendar) => (
            <SubCalendarItem key={calendar.id} calendar={calendar} />
          ))}
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <Heading2>Destinations</Heading2>
        <Copy className="text-xs">Select which destinations to sync events to.</Copy>
        <List>
          {destinations.map((destination) => (
            <CalendarCheckboxItem
              key={destination.id}
              id={destination.id}
              name={destination.name}
              email={destination.email}
              providerIcon={destination.provider.icon}
              providerName={destination.provider.name}
              checked={destination.enabled}
              onChange={() => handleToggleDestination(destination.id)}
            />
          ))}
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <Heading2>Sync Settings</Heading2>
        <Copy className="text-xs">Choose what event data to sync.</Copy>
        <List>
          <ListItemCheckbox id="sync-summaries" checked={syncSummaries} onChange={setSyncSummaries}>
            <ListItemLabel>Sync event summaries</ListItemLabel>
          </ListItemCheckbox>
          <ListItemCheckbox id="sync-descriptions" checked={syncDescriptions} onChange={setSyncDescriptions}>
            <ListItemLabel>Sync event descriptions</ListItemLabel>
          </ListItemCheckbox>
        </List>
      </div>

      <div className="flex flex-col gap-4">
        <Heading2>Custom Values</Heading2>
        <div className="flex flex-col gap-2">
          <Copy className="text-xs">Replace event titles with a custom name.</Copy>
          <Input
            inputSize="small"
            value={customSummary}
            onChange={({ target }) => setCustomSummary(target.value)}
            placeholder="Custom event name"
            disabled={syncSummaries}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Copy className="text-xs">Replace event descriptions with custom text.</Copy>
          <Input
            inputSize="small"
            value={customDescription}
            onChange={({ target }) => setCustomDescription(target.value)}
            placeholder="Custom event description"
            disabled={syncDescriptions}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Heading2>Danger Zone</Heading2>
        <Copy className="text-xs">Permanently remove this source and all synced events.</Copy>
        <Button
          variant="outline"
          className="text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setDeleteSourceOpen(true)}
        >
          <Trash2 size={14} />
          <ButtonText>Delete Source</ButtonText>
        </Button>
      </div>

      <Modal open={deleteSourceOpen} onClose={() => setDeleteSourceOpen(false)}>
        <ModalHeader
          title="Delete source"
          description={`Are you sure you want to delete "${source.name}"? All synced events from this source will be removed from your destinations.`}
          onClose={() => setDeleteSourceOpen(false)}
        />
        <ModalFooter
          onCancel={() => setDeleteSourceOpen(false)}
          onConfirm={() => setDeleteSourceOpen(false)}
          confirmText="Delete source"
          variant="danger"
        />
      </Modal>
    </div>
  );
};

export default CalendarDetailPage;
