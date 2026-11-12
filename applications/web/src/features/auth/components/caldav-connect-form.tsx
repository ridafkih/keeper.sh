import { useRef, useState, useTransition, type ReactNode } from "react";
import { useNavigateAfterConnect } from "@/lib/connect-return";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { useSWRConfig } from "swr";
import { useSetAtom } from "jotai";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Divider } from "@/components/ui/primitives/divider";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { apiFetch, HttpError } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { resolveCalDAVImportNotice } from "@/lib/caldav-import-notice";
import { showToastAtom } from "@/state/toast";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { describeCalendarImportFailure } from "@/lib/connect-failures";

export type CalDAVProvider = "fastmail" | "icloud" | "caldav";

interface ProviderConfig {
  serverUrl: string;
  showServerUrlInput: boolean;
  usernamePlaceholder: string;
  usernameInputType: string;
  passwordPlaceholder: string;
  credentialsFailure: string;
}

const PROVIDER_CONFIGS: Record<CalDAVProvider, ProviderConfig> = {
  fastmail: {
    serverUrl: "https://caldav.fastmail.com/",
    showServerUrlInput: false,
    usernamePlaceholder: "Fastmail Email Address",
    usernameInputType: "email",
    passwordPlaceholder: "App-Specific Password",
    credentialsFailure: "Fastmail needs an app password here, not your Fastmail password.",
  },
  icloud: {
    serverUrl: "https://caldav.icloud.com/",
    showServerUrlInput: false,
    usernamePlaceholder: "Apple ID",
    usernameInputType: "email",
    passwordPlaceholder: "App-Specific Password",
    credentialsFailure: "Apple needs an app-specific password here, not your Apple password.",
  },
  caldav: {
    serverUrl: "",
    showServerUrlInput: true,
    usernamePlaceholder: "CalDAV Server Username",
    usernameInputType: "text",
    passwordPlaceholder: "CalDAV Server Password",
    credentialsFailure: "That username or password didn't work.",
  },
};

interface CalendarOption {
  url: string;
  displayName: string;
}

interface CalDAVConnectFormProps {
  provider: CalDAVProvider;
  credentialHelp?: ReactNode;
  onCredentialsRejected?: () => void;
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

function parseAuthMethod(value: unknown): "basic" | "digest" {
  if (!isRecord(value)) return "basic";
  if (value.authMethod === "digest") return "digest";
  return "basic";
}

function parseAccountId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.accountId === "string") return value.accountId;
  return undefined;
}

export function CalDAVConnectForm({ provider, credentialHelp, onCredentialsRejected }: CalDAVConnectFormProps) {
  const config = PROVIDER_CONFIGS[provider];
  const navigateAfterConnect = useNavigateAfterConnect();
  const { mutate: globalMutate } = useSWRConfig();
  const showToast = useSetAtom(showToastAtom);
  const formRef = useRef<HTMLFormElement>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [credentialsRejected, setCredentialsRejected] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCredentialsRejected(false);

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
        if (err instanceof HttpError && err.status === HTTP_STATUS.UNAUTHORIZED) {
          setError(PROVIDER_CONFIGS[provider].credentialsFailure);
          setCredentialsRejected(true);
          onCredentialsRejected?.();
          return;
        }
        setError("Couldn't find calendars on this server. Check the details and try again.");
        return;
      }

      const discoverPayload = await discoverResponse.json();
      const calendars = parseCalendarOptions(discoverPayload);
      const authMethod = parseAuthMethod(discoverPayload);
      if (!calendars) {
        setError("Failed to parse discovered calendars");
        return;
      }

      if (calendars.length === 0) {
        setError("No calendars found");
        return;
      }

      let accountId: string | undefined;
      let importNotice: string | null = null;

      try {
        const importResponse = await apiFetch("/api/sources/caldav", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authMethod,
            calendars: calendars.map((calendar) => ({
              calendarUrl: calendar.url,
              name: calendar.displayName,
            })),
            password,
            provider,
            serverUrl,
            username,
          }),
        });
        const importPayload: unknown = await importResponse.json();
        accountId = parseAccountId(importPayload);
        importNotice = resolveCalDAVImportNotice(
          isRecord(importPayload) ? importPayload.calendars : undefined,
        );
      } catch (err) {
        setError(describeCalendarImportFailure(err));
        return;
      }

      await invalidateAccountsAndSources(globalMutate);

      if (importNotice) {
        showToast(importNotice);
      }

      await navigateAfterConnect(accountId);
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
          tone={credentialsRejected ? "error" : "neutral"}
          aria-invalid={credentialsRejected}
        />
      </div>
      {error && <Text size="sm" tone="danger">{error}</Text>}
      {credentialsRejected && credentialHelp}
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
