"use client";

import { useState } from "react";
import type { FC, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/button";
import { button, dialogPopup, input } from "@/styles";
import { CardTitle, DangerText, TextBody, TextCaption } from "@/components/typography";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { getProvider } from "@keeper.sh/provider-registry";
import type { CalDAVProviderId, CalDAVProviderConfig } from "@keeper.sh/provider-registry";

type CalDAVSourceProvider = CalDAVProviderId;

interface CalendarOption {
  url: string;
  displayName: string;
}

const getCalDAVConfig = (providerId: CalDAVProviderId): CalDAVProviderConfig => {
  const provider = getProvider(providerId);
  if (!provider?.caldav) {
    throw new Error(`Provider ${providerId} is missing CalDAV configuration`);
  }
  return provider.caldav;
};

interface CalDAVSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CalDAVSourceProvider;
  onSuccess: () => void;
}

type Step = "credentials" | "calendar";

const getDialogDescription = (currentStep: Step, providerName: string): string => {
  if (currentStep === "credentials") {
    return `Enter your ${providerName} credentials to import events.`;
  }
  return "Choose which calendar to import events from.";
};

export const CalDAVSourceDialog: FC<CalDAVSourceDialogProps> = ({
  open,
  onOpenChange,
  provider,
  onSuccess,
}) => {
  const providerDefinition = getProvider(provider);
  if (!providerDefinition) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  const config = getCalDAVConfig(provider);

  const [step, setStep] = useState<Step>("credentials");
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = (): void => {
    setStep("credentials");
    setServerUrl(config.serverUrl);
    setUsername("");
    setPassword("");
    setCalendars([]);
    setSelectedCalendar("");
    setSourceName("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleDiscoverCalendars = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sources/caldav/discover", {
        body: JSON.stringify({ password, serverUrl, username }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Failed to discover calendars");
        return;
      }

      const data = await response.json();

      if (data.calendars.length === 0) {
        setError("No calendars found");
        return;
      }

      setCalendars(data.calendars);
      setSelectedCalendar(data.calendars[0].url);
      setSourceName(data.calendars[0].displayName);
      setStep("calendar");
    } catch {
      setError("Connection failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sources/caldav", {
        body: JSON.stringify({
          calendarUrl: selectedCalendar,
          name: sourceName,
          password,
          provider,
          serverUrl,
          username,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();

        if (response.status === HTTP_STATUS.PAYMENT_REQUIRED) {
          return setError("Source limit reached. Upgrade to Pro.");
        }

        return setError(data.error || "Failed to add source");
      }

      onSuccess();
      handleOpenChange(false);
    } catch {
      setError("Connection failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalendarChange = (calendarUrl: string): void => {
    setSelectedCalendar(calendarUrl);
    const selectedCalendarData = calendars.find((cal) => cal.url === calendarUrl);
    if (selectedCalendarData) {
      setSourceName(selectedCalendarData.displayName);
    }
  };

  const renderCredentialsStep = (): ReactNode => (
    <form onSubmit={handleDiscoverCalendars} className="flex flex-col gap-3">
      {provider === "caldav" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="caldav-source-server-url" className="text-sm font-medium text-foreground">
            Server URL
          </label>
          <input
            id="caldav-source-server-url"
            type="url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://caldav.example.com/dav/"
            required
            className={input({ size: "sm" })}
          />
          <TextCaption as="span" className="text-foreground-muted">
            The CalDAV server URL
          </TextCaption>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="caldav-source-username" className="text-sm font-medium text-foreground">
          {config.usernameLabel}
        </label>
        <input
          id="caldav-source-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          autoComplete="username"
          className={input({ size: "sm" })}
        />
        <TextCaption as="span" className="text-foreground-muted">
          {config.usernameHelp}
        </TextCaption>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="caldav-source-password" className="text-sm font-medium text-foreground">
          {config.passwordLabel}
        </label>
        <input
          id="caldav-source-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
          className={input({ size: "sm" })}
        />
        <TextCaption as="span" className="text-foreground-muted">
          {config.passwordHelp}
        </TextCaption>
      </div>
      {error && (
        <DangerText as="p" className="text-xs">
          {error}
        </DangerText>
      )}
      <div className="flex gap-2 justify-end">
        <Dialog.Close className={button({ size: "sm", variant: "secondary" })}>Cancel</Dialog.Close>
        <Button
          type="submit"
          isLoading={isLoading}
          className={button({ size: "sm", variant: "primary" })}
        >
          Continue
        </Button>
      </div>
    </form>
  );

  const renderCalendarStep = (): ReactNode => (
    <form onSubmit={handleConnect} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="caldav-source-calendar-select" className="text-sm font-medium text-foreground">
          Select Calendar
        </label>
        <select
          id="caldav-source-calendar-select"
          value={selectedCalendar}
          onChange={(event) => handleCalendarChange(event.target.value)}
          required
          className={input({ size: "sm" })}
        >
          {calendars.map((cal) => (
            <option key={cal.url} value={cal.url}>
              {cal.displayName}
            </option>
          ))}
        </select>
        <TextCaption as="span" className="text-foreground-muted">
          Events from this calendar will be synced
        </TextCaption>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="caldav-source-name" className="text-sm font-medium text-foreground">
          Source Name
        </label>
        <input
          id="caldav-source-name"
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
        <button
          type="button"
          onClick={() => setStep("credentials")}
          className={button({ size: "sm", variant: "secondary" })}
        >
          Back
        </button>
        <Button
          type="submit"
          isLoading={isLoading}
          className={button({ size: "sm", variant: "primary" })}
        >
          Add Source
        </Button>
      </div>
    </form>
  );

  const renderCurrentStep = (currentStep: Step): ReactNode => {
    if (currentStep === "credentials") {
      return renderCredentialsStep();
    }
    return renderCalendarStep();
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "md" })}>
          <Dialog.Title render={<CardTitle />}>Add {providerDefinition.name} Source</Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-3" />}>
            {getDialogDescription(step, providerDefinition.name)}
          </Dialog.Description>
          {renderCurrentStep(step)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export type { CalDAVSourceProvider };
