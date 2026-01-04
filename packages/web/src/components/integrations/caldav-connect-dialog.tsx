"use client";

import { useState, type FC } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/button";
import { button, input, dialogPopup } from "@/styles";
import {
  CardTitle,
  TextBody,
  TextCaption,
  DangerText,
} from "@/components/typography";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { type CalDAVDestinationId } from "@keeper.sh/destination-metadata";

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

const PROVIDER_CONFIGS: Record<CalDAVDestinationId, ProviderConfig> = {
  fastmail: {
    name: "FastMail",
    serverUrl: "https://caldav.fastmail.com/",
    usernameLabel: "Email",
    usernameHelp: "Your FastMail email address",
    passwordLabel: "App Password",
    passwordHelp:
      "Generate one at Settings → Password & Security → Third-party apps",
  },
  icloud: {
    name: "iCloud",
    serverUrl: "https://caldav.icloud.com/",
    usernameLabel: "Apple ID",
    usernameHelp: "Your Apple ID email address",
    passwordLabel: "App-Specific Password",
    passwordHelp: "Generate one at appleid.apple.com → Sign-In and Security",
  },
  caldav: {
    name: "CalDAV",
    serverUrl: "",
    usernameLabel: "Username",
    usernameHelp: "Your CalDAV username",
    passwordLabel: "Password",
    passwordHelp: "Your CalDAV password or app password",
  },
};

interface CalDAVConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: CalDAVDestinationId;
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

  const resetForm = () => {
    setStep("credentials");
    setServerUrl(config.serverUrl);
    setUsername("");
    setPassword("");
    setCalendars([]);
    setSelectedCalendar("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleDiscoverCalendars = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/destinations/caldav/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl, username, password }),
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

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/destinations/caldav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl,
          username,
          password,
          calendarUrl: selectedCalendar,
          provider,
        }),
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

  const renderCredentialsStep = () => (
    <form onSubmit={handleDiscoverCalendars} className="flex flex-col gap-3">
      {provider === "caldav" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Server URL
          </label>
          <input
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
        <label className="text-sm font-medium text-foreground">
          {config.usernameLabel}
        </label>
        <input
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
        <label className="text-sm font-medium text-foreground">
          {config.passwordLabel}
        </label>
        <input
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
        <Dialog.Close className={button({ variant: "secondary", size: "sm" })}>
          Cancel
        </Dialog.Close>
        <Button
          type="submit"
          isLoading={isLoading}
          className={button({ variant: "primary", size: "sm" })}
        >
          Continue
        </Button>
      </div>
    </form>
  );

  const renderCalendarStep = () => (
    <form onSubmit={handleConnect} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Select Calendar
        </label>
        <select
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
          className={button({ variant: "secondary", size: "sm" })}
        >
          Back
        </button>
        <Button
          type="submit"
          isLoading={isLoading}
          className={button({ variant: "primary", size: "sm" })}
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
          <Dialog.Title render={<CardTitle />}>
            Connect {config.name}
          </Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-3" />}>
            {step === "credentials"
              ? `Enter your ${config.name} credentials to connect your calendar.`
              : "Choose which calendar to sync events to."}
          </Dialog.Description>
          {step === "credentials"
            ? renderCredentialsStep()
            : renderCalendarStep()}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
