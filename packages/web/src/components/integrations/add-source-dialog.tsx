"use client";

import type { FC, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { dialogPopup } from "@/styles";
import { CardTitle, TextBody, TextCaption } from "@/components/typography";
import { Link as LinkIcon, Calendar, Cloud, Mail, Apple, Server } from "lucide-react";

type SourceType = "ics" | "google" | "outlook" | "caldav" | "fastmail" | "icloud";

interface SourceTypeOption {
  id: SourceType;
  name: string;
  description: string;
  icon: ReactNode;
}

const SOURCE_TYPE_OPTIONS: SourceTypeOption[] = [
  {
    description: "Import events from any iCal/ICS feed URL",
    icon: <LinkIcon size={16} />,
    id: "ics",
    name: "iCal Link",
  },
  {
    description: "Connect your Google Calendar",
    icon: <Calendar size={16} />,
    id: "google",
    name: "Google Calendar",
  },
  {
    description: "Connect your Outlook Calendar",
    icon: <Cloud size={16} />,
    id: "outlook",
    name: "Outlook",
  },
  {
    description: "Connect any CalDAV-compatible calendar",
    icon: <Server size={16} />,
    id: "caldav",
    name: "CalDAV",
  },
  {
    description: "Connect your FastMail calendar",
    icon: <Mail size={16} />,
    id: "fastmail",
    name: "FastMail",
  },
  {
    description: "Connect your iCloud calendar",
    icon: <Apple size={16} />,
    id: "icloud",
    name: "iCloud",
  },
];

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectType: (type: SourceType) => void;
}

export const AddSourceDialog: FC<AddSourceDialogProps> = ({
  open,
  onOpenChange,
  onSelectType,
}) => {
  const handleSelect = (type: SourceType): void => {
    onSelectType(type);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "md" })}>
          <Dialog.Title render={<CardTitle />}>Add Calendar Source</Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-4" />}>
            Choose how you want to add a calendar source.
          </Dialog.Description>
          <div className="flex flex-col gap-2">
            {SOURCE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSelect(option.id)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-border-hover hover:bg-background-hover transition-colors text-left"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-background-subtle text-foreground-muted">
                  {option.icon}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{option.name}</div>
                  <TextCaption>{option.description}</TextCaption>
                </div>
              </button>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export type { SourceType };
