import { useRef, useState, useTransition } from "react";
import { useNavigate } from "@tanstack/react-router";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { useSWRConfig } from "swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Divider } from "@/components/ui/primitives/divider";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { apiFetch } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { resolveErrorMessage } from "@/utils/errors";

export type CalDAVProvider = "fastmail" | "icloud" | "caldav";

interface ProviderConfig {
  serverUrl: string;
  showServerUrlInput: boolean;
  usernamePlaceholder: string;
  usernameInputType: string;
  passwordPlaceholder: string;
}

const PROVIDER_CONFIGS: Record<CalDAVProvider, ProviderConfig> = {
  fastmail: {
    serverUrl: "https://caldav.fastmail.com/",
    showServerUrlInput: false,
    usernamePlaceholder: "Fastmail Email Address",
    usernameInputType: "email",
    passwordPlaceholder: "App-Specific Password",
  },
  icloud: {
    serverUrl: "https://caldav.icloud.com/",
    showServerUrlInput: false,
    usernamePlaceholder: "Apple ID",
    usernameInputType: "email",
    passwordPlaceholder: "App-Specific Password",
  },
  caldav: {
    serverUrl: "",
    showServerUrlInput: true,
    usernamePlaceholder: "CalDAV Server Username",
    usernameInputType: "text",
    passwordPlaceholder: "CalDAV Server Password",
  },
};

interface CalendarOption {
  url: string;
  displayName: string;
}

interface CalDAVConnectFormProps {
  provider: CalDAVProvider;
}

function readFormFieldValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  if (typeof value === "string") return value;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCalendarOption(value: unknown): value is CalendarOption {
  if (!isRecord(value)) return false;
  return typeof value.url === "string" && typeof value.displayName === "string";
}

function parseCalendarOptions(value: unknown): CalendarOption[] | null {
  if (!isRecord(value)) return null;
  const calendars = value.calendars;
  if (!Array.isArray(calendars)) return null;
  if (!calendars.every(isCalendarOption)) return null;
  return calendars;
}

function parseAccountId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.accountId === "string") return value.accountId;
  return undefined;
}

export function CalDAVConnectForm({ provider }: CalDAVConnectFormProps) {
  const config = PROVIDER_CONFIGS[provider];
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const formRef = useRef<HTMLFormElement>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const serverUrl = readFormFieldValue(formData, "serverUrl");
    const username = readFormFieldValue(formData, "username");
    const password = readFormFieldValue(formData, "password");

    if (!serverUrl || !username || !password) {
      setError("Missing required credentials");
      return;
    }

    startTransition(async () => {
      let discoverResponse: Response;
      try {
        discoverResponse = await apiFetch("/api/sources/caldav/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverUrl, username, password }),
        });
      } catch (err) {
        setError(resolveErrorMessage(err, "Failed to discover calendars"));
        return;
      }

      const discoverPayload = await discoverResponse.json();
      const calendars = parseCalendarOptions(discoverPayload);
      if (!calendars) {
        setError("Failed to parse discovered calendars");
        return;
      }

      if (calendars.length === 0) {
        setError("No calendars found");
        return;
      }

      let accountId: string | undefined;

      try {
        const responses = await Promise.all(
          calendars.map((calendar) =>
            apiFetch("/api/sources/caldav", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                calendarUrl: calendar.url,
                name: calendar.displayName,
                password,
                provider,
                serverUrl,
                username,
              }),
            }),
          ),
        );

        const firstResponse = responses[0];
        if (firstResponse) {
          accountId = parseAccountId(await firstResponse.json());
        }
      } catch {
        setError("Failed to import calendars");
        return;
      }

      await invalidateAccountsAndSources(globalMutate);

      if (accountId) {
        navigate({ to: "/dashboard/accounts/$accountId/setup", params: { accountId } });
      } else {
        navigate({ to: "/dashboard" });
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {config.showServerUrlInput ? (
          <Input
            name="serverUrl"
            defaultValue={config.serverUrl}
            type="url"
            placeholder="CalDAV Server URL"
            required
          />
        ) : (
          <Input type="hidden" name="serverUrl" defaultValue={config.serverUrl} />
        )}
        <Input
          name="username"
          type={config.usernameInputType}
          placeholder={config.usernamePlaceholder}
          required
        />
        <Input
          name="password"
          type="password"
          placeholder={config.passwordPlaceholder}
          required
        />
      </div>
      {error && <Text size="sm" tone="danger">{error}</Text>}
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center" disabled={isPending}>
          {isPending && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{isPending ? "Connecting..." : "Connect"}</ButtonText>
        </Button>
      </div>
    </form>
  );
}
