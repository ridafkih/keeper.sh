"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Toast } from "@/components/toast-provider";
import { useSources, type CalendarSource } from "@/hooks/use-sources";
import {
  button,
  input,
  label,
  integrationCard,
  integrationIcon,
  integrationInfo,
  integrationName,
  integrationDescription,
} from "@/styles";

const SourceItem = ({
  source,
  onRemove,
}: {
  source: CalendarSource;
  onRemove: () => void;
}) => (
  <div className={integrationCard()}>
    <div className={integrationInfo()}>
      <div className={integrationName()}>{source.name}</div>
      <div className={integrationDescription()}>{source.url}</div>
    </div>
    <Button onClick={onRemove} className={button({ variant: "secondary" })}>
      Remove
    </Button>
  </div>
);

const SourcesList = ({
  sources,
  isLoading,
  onRemove,
}: {
  sources: CalendarSource[] | undefined;
  isLoading: boolean;
  onRemove: (id: string) => void;
}) => {
  if (isLoading) {
    return <div className="text-sm text-gray-500 py-4">Loading...</div>;
  }

  if (!sources?.length) {
    return (
      <div className="text-sm text-gray-500 py-4">
        No calendar sources added yet
      </div>
    );
  }

  return (
    <>
      {sources.map((source) => (
        <SourceItem
          key={source.id}
          source={source}
          onRemove={() => onRemove(source.id)}
        />
      ))}
    </>
  );
};

const AddSourceDialog = ({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, url: string) => Promise<void>;
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const name = formData.get("name") as string;
    const url = formData.get("url") as string;

    try {
      await onAdd(name, url);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to add source");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger className={button({ variant: "secondary" })}>
        Add iCal Link
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Add Calendar Source
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Enter an iCal URL to import events from another calendar.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="source-name" className={label()}>
                Name
              </label>
              <input
                id="source-name"
                name="name"
                type="text"
                placeholder="Work Calendar"
                autoComplete="off"
                required
                className={input()}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="source-url" className={label()}>
                iCal URL
              </label>
              <input
                id="source-url"
                name="url"
                type="url"
                placeholder="https://calendar.google.com/calendar/ical/..."
                autoComplete="off"
                required
                className={input()}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end mt-2">
              <Dialog.Close className={button({ variant: "secondary" })}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                disabled={isSubmitting}
                className={button({ variant: "primary" })}
              >
                {isSubmitting ? "Adding..." : "Add Source"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const CalendarSourcesSection = () => {
  const toastManager = Toast.useToastManager();
  const { data: sources, isLoading, mutate } = useSources();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleAddSource = async (name: string, url: string) => {
    const response = await fetch("/api/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to add source");
    }

    await mutate();
    toastManager.add({ title: "Calendar source added" });
  };

  const handleRemoveSource = async (id: string) => {
    try {
      const response = await fetch(`/api/ics/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await mutate();
        toastManager.add({ title: "Calendar source removed" });
      }
    } catch {
      toastManager.add({ title: "Failed to remove source" });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Calendar Sources</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Add iCal links to import events from other calendars
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <SourcesList
          sources={sources}
          isLoading={isLoading}
          onRemove={handleRemoveSource}
        />
        <AddSourceDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onAdd={handleAddSource}
        />
      </div>
    </section>
  );
};

interface Destination {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

const DESTINATIONS: Destination[] = [
  {
    id: "google",
    name: "Google Calendar",
    description: "Sync your aggregated events to Google Calendar",
    icon: "/integrations/icon-google.svg",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Sync your aggregated events to Outlook",
    icon: "/integrations/icon-outlook.svg",
  },
  {
    id: "caldav",
    name: "CalDAV",
    description: "Sync to any CalDAV-compatible server",
  },
];

const DestinationItem = ({ destination }: { destination: Destination }) => (
  <div className={integrationCard()}>
    <div className={integrationIcon()}>
      {destination.icon && (
        <Image
          src={destination.icon}
          alt={destination.name}
          width={20}
          height={20}
        />
      )}
    </div>
    <div className={integrationInfo()}>
      <div className={integrationName()}>{destination.name}</div>
      <div className={integrationDescription()}>{destination.description}</div>
    </div>
    <Button className={button({ variant: "secondary" })}>Connect</Button>
  </div>
);

export const DestinationsSection = () => (
  <section className="flex flex-col gap-3">
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Destinations</h2>
      <p className="text-sm text-gray-500 mt-0.5">
        Push your aggregated events to other calendar apps
      </p>
    </div>
    <div className="flex flex-col gap-1.5">
      {DESTINATIONS.map((destination) => (
        <DestinationItem key={destination.id} destination={destination} />
      ))}
    </div>
  </section>
);

export const ICalLinkSection = () => {
  const toastManager = Toast.useToastManager();
  const icalUrl = "https://keeper.sh/cal/abc123.ics";

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(icalUrl);
    toastManager.add({ title: "Copied to clipboard" });
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Your iCal Link</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Subscribe to this link to view your aggregated events
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={icalUrl}
          readOnly
          className={input({ readonly: true, className: "flex-1" })}
        />
        <Button
          onClick={copyToClipboard}
          className={button({ variant: "secondary" })}
        >
          Copy
        </Button>
      </div>
    </section>
  );
};
