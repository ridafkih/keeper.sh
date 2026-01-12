"use client";

import type { FC } from "react";
import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Heading1, Heading2 } from "../../../../components/heading";
import { Copy } from "../../../../components/copy";
import { Button, ButtonText } from "../../../../components/button";
import { Checkbox } from "../../../../components/checkbox";
import { Input } from "../../../../components/input";
import { Modal, ModalHeader, ModalFooter } from "../../../../compositions/modal/modal";
import { List, ListItemCheckbox, ListItemLabel, ListItemValue } from "../../../../components/list";

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

interface SourceDetail {
  id: string;
  name: string;
  email: string;
  provider: {
    id: string;
    name: string;
    icon: string;
  };
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
      <div className="size-1 rounded-full" style={{ backgroundColor: calendar.color }} />
      <ListItemLabel>{calendar.name}</ListItemLabel>
    </div>
  </ListItemCheckbox>
);

interface DestinationOptionItemProps {
  destination: DestinationOption;
}

const DestinationOptionItem: FC<DestinationOptionItemProps> = ({ destination }) => (
  <ListItemCheckbox id={destination.id} defaultChecked={destination.enabled}>
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
  </ListItemCheckbox>
);

interface CalendarDetailPageProps {
  params: Promise<{ calendarId: string }>;
}

const CalendarDetailPage: FC<CalendarDetailPageProps> = ({ params }) => {
  const { calendarId } = use(params);
  const source = MOCK_SOURCE;

  const [syncSummaries, setSyncSummaries] = useState(source.syncSettings.summaries);
  const [customSummary, setCustomSummary] = useState(source.name);

  const [syncDescriptions, setSyncDescriptions] = useState(source.syncSettings.descriptions);
  const [customDescription, setCustomDescription] = useState("");

  const [deleteSourceOpen, setDeleteSourceOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8 pt-16 pb-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/playground/dashboard/calendars"
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft size={12} />
          Back
        </Link>
        <div className="flex flex-col gap-1">
          <Heading1>{source.name}</Heading1>
          <div className="flex items-center gap-2">
            <Image
              src={source.provider.icon}
              alt={source.provider.name}
              width={14}
              height={14}
            />
            <Copy as="span" className="text-xs">{source.email}</Copy>
            <span className="text-xs text-neutral-400">·</span>
            <span className="text-xs text-neutral-500">Source</span>
          </div>
        </div>
      </div>

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
          {source.destinations.map((destination) => (
            <DestinationOptionItem key={destination.id} destination={destination} />
          ))}
        </List>
      </div>

      <div className="flex flex-col gap-6">
        <Heading2>Sync Settings</Heading2>

        <div className="flex flex-col gap-2">
          <Checkbox
            checkboxSize="small"
            label="Sync event summaries"
            checked={syncSummaries}
            onChange={(e) => setSyncSummaries(e.target.checked)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Event name</label>
            <Input
              inputSize="small"
              value={customSummary}
              onChange={(e) => setCustomSummary(e.target.value)}
              placeholder="Busy"
              disabled={syncSummaries}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Checkbox
            checkboxSize="small"
            label="Sync event descriptions"
            checked={syncDescriptions}
            onChange={(e) => setSyncDescriptions(e.target.checked)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Event description</label>
            <Input
              inputSize="small"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="No description"
              disabled={syncDescriptions}
            />
          </div>
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
