"use client";

import { useState, useEffect } from "react";
import type { FC, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/button";
import { button, dialogPopup, input } from "@/styles";
import { CardTitle, DangerText, TextBody, TextCaption } from "@/components/typography";
import { HTTP_STATUS } from "@keeper.sh/constants";

type OAuthSourceProvider = "google" | "outlook";

interface CalendarOption {
  id: string;
  summary: string;
  primary?: boolean;
}

interface OAuthSourceCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: OAuthSourceProvider;
  credentialId: string;
  onSuccess: () => void;
}

const PROVIDER_NAMES: Record<OAuthSourceProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
};

export const OAuthSourceCalendarDialog: FC<OAuthSourceCalendarDialogProps> = ({
  open,
  onOpenChange,
  provider,
  credentialId,
  onSuccess,
}) => {
  const providerName = PROVIDER_NAMES[provider];

  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !credentialId) {
      return;
    }

    setIsLoadingCalendars(true);
    setError(null);

    const fetchCalendars = async (): Promise<void> => {

      try {
        const response = await fetch(
          `/api/sources/${provider}/calendars?credentialId=${credentialId}`,
        );

        if (!response.ok) {
          setError("Failed to load calendars");
          return;
        }

        const data = await response.json();
        const calendarList = data.calendars as CalendarOption[];
        setCalendars(calendarList);

        const primaryCalendar = calendarList.find((cal) => cal.primary);
        const defaultCalendar = primaryCalendar ?? calendarList[0];

        if (defaultCalendar) {
          setSelectedCalendar(defaultCalendar.id);
          setSourceName(defaultCalendar.summary);
        }
      } catch {
        setError("Failed to load calendars");
      } finally {
        setIsLoadingCalendars(false);
      }
    };

    fetchCalendars();
  }, [open, credentialId, provider]);

  const resetForm = (): void => {
    setCalendars([]);
    setSelectedCalendar("");
    setSourceName("");
    setIsLoadingCalendars(true);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleCalendarChange = (calendarId: string): void => {
    setSelectedCalendar(calendarId);
    const selected = calendars.find((cal) => cal.id === calendarId);
    if (selected) {
      setSourceName(selected.summary);
    }
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sources/${provider}`, {
        body: JSON.stringify({
          externalCalendarId: selectedCalendar,
          name: sourceName,
          oauthSourceCredentialId: credentialId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();

        if (response.status === HTTP_STATUS.PAYMENT_REQUIRED) {
          setError("Source limit reached. Upgrade to Pro.");
          return;
        }

        if (response.status === HTTP_STATUS.CONFLICT) {
          setError("This calendar is already added as a source");
          return;
        }

        setError(data.error || "Failed to add source");
        return;
      }

      onSuccess();
      handleOpenChange(false);
    } catch {
      setError("Failed to add source");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderContent = (): ReactNode => {
    if (isLoadingCalendars) {
      return (
        <div className="flex items-center justify-center py-8">
          <TextCaption>Loading calendars...</TextCaption>
        </div>
      );
    }

    if (calendars.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <TextCaption>No calendars found</TextCaption>
          <Dialog.Close className={button({ size: "sm", variant: "secondary" })}>
            Close
          </Dialog.Close>
        </div>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="oauth-source-calendar-select"
            className="text-sm font-medium text-foreground"
          >
            Select Calendar
          </label>
          <select
            id="oauth-source-calendar-select"
            value={selectedCalendar}
            onChange={(event) => handleCalendarChange(event.target.value)}
            required
            className={input({ size: "sm" })}
          >
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.summary}
              </option>
            ))}
          </select>
          <TextCaption as="span" className="text-foreground-muted">
            Events from this calendar will be synced
          </TextCaption>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="oauth-source-name" className="text-sm font-medium text-foreground">
            Source Name
          </label>
          <input
            id="oauth-source-name"
            type="text"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            required
            className={input({ size: "sm" })}
          />
          <TextCaption as="span" className="text-foreground-muted">
            A friendly name for this source
          </TextCaption>
        </div>
        {error && (
          <DangerText as="p" className="text-xs">
            {error}
          </DangerText>
        )}
        <div className="flex gap-2 justify-end">
          <Dialog.Close className={button({ size: "sm", variant: "secondary" })}>
            Cancel
          </Dialog.Close>
          <Button
            type="submit"
            isLoading={isSubmitting}
            className={button({ size: "sm", variant: "primary" })}
          >
            Add Source
          </Button>
        </div>
      </form>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "md" })}>
          <Dialog.Title render={<CardTitle />}>Add {providerName} Source</Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-3" />}>
            Choose which calendar to import events from.
          </Dialog.Description>
          {renderContent()}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export type { OAuthSourceProvider };
