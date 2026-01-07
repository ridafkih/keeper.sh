"use client";

import { useState } from "react";
import type { FC, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/button";
import { button, dialogPopup, input } from "@/styles";
import { CardTitle, DangerText, TextBody, TextCaption } from "@/components/typography";
import { HTTP_STATUS } from "@keeper.sh/constants";
import type { CalDAVProviderId } from "@keeper.sh/provider-registry";

interface CalendarOption {
  url: string;
  displayName: string;
}

interface ProviderConfig {
  name: string;
  serverUrl: string;
  usernameLabel: string;
  usernameHelp: string;
  passwordLabel: string;
  passwordHelp: string;
}

const PROVIDER_CONFIGS: Record<CalDAVProviderId, ProviderConfig> = {
  caldav: {
    name: "CalDAV",
    passwordHelp: "Your CalDAV password or app password",
    passwordLabel: "Password",
    serverUrl: "",
    usernameHelp: "Your CalDAV username",
    usernameLabel: "Username",
  },
  fastmail: {
    name: "FastMail",
    passwordHelp: "Generate one at Settings → Password & Security → Third-party apps",
    passwordLabel: "App Password",
    serverUrl: "https://caldav.fastmail.com/",
    usernameHelp: "Your FastMail email address",
    usernameLabel: "Email",
  },
  icloud: {
    name: "iCloud",
    passwordHelp: "Generate one at appleid.apple.com → Sign-In and Security",
    passwordLabel: "App-Specific Password",
    serverUrl: "https://caldav.icloud.com/",
    usernameHelp: "Your Apple ID email address",
    usernameLabel: "Apple ID",
  },
};

interface CalDAVConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CalDAVProviderId;
  onSuccess: () => void;
}

type Step = "credentials" | "calendar";

export const CalDAVConnectDialog: FC<CalDAVConnectDialogProps> = ({
  open,
  onOpenChange,
  provider,
  onSuccess,
}) => {
  const config = PROVIDER_CONFIGS[provider];

  const [step, setStep] = useState<Step>("credentials");
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = (): void => {
    setStep("credentials");
    setServerUrl(config.serverUrl);
    setUsername("");
    setPassword("");
    setCalendars([]);
    setSelectedCalendar("");
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
      const response = await fetch("/api/destinations/caldav/discover", {
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
      const response = await fetch("/api/destinations/caldav", {
        body: JSON.stringify({
          calendarUrl: selectedCalendar,
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
          return setError("Destination limit reached. Upgrade to Pro.");
        }

        return setError(data.error || "Failed to connect");
      }

      onSuccess();
      handleOpenChange(false);
    } catch {
      setError("Connection failed");
    } finally {
      setIsLoading(false);
    }
  };

  const renderCredentialsStep = (): ReactNode => (
    <form onSubmit={handleDiscoverCalendars} className="flex flex-col gap-3">
      {provider === "caldav" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="caldav-server-url" className="text-sm font-medium text-foreground">
            Server URL
          </label>
          <input
            id="caldav-server-url"
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
        <label htmlFor="caldav-username" className="text-sm font-medium text-foreground">
          {config.usernameLabel}
        </label>
        <input
          id="caldav-username"
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
        <label htmlFor="caldav-password" className="text-sm font-medium text-foreground">
          {config.passwordLabel}
        </label>
        <input
          id="caldav-password"
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
        <label htmlFor="caldav-calendar-select" className="text-sm font-medium text-foreground">
          Select Calendar
        </label>
        <select
          id="caldav-calendar-select"
          value={selectedCalendar}
          onChange={(event) => setSelectedCalendar(event.target.value)}
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
          Events will be synced to this calendar
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
          Connect
        </Button>
      </div>
    </form>
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "md" })}>
          <Dialog.Title render={<CardTitle />}>Connect {config.name}</Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-3" />}>
            {(() => {
              if (step === "credentials") {
                return `Enter your ${config.name} credentials to connect your calendar.`;
              }
              return "Choose which calendar to sync events to.";
            })()}
          </Dialog.Description>
          {(() => {
            if (step === "credentials") {
              return renderCredentialsStep();
            }
            return renderCalendarStep();
          })()}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
