import { useRef, useState, useTransition } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useSWRConfig } from "swr";
import { BackButton } from "../ui/back-button";
import { Button, ButtonText } from "../ui/button";
import { Divider } from "../ui/divider";
import { Input } from "../ui/input";
import { Text } from "../ui/text";
import { apiFetch } from "../../lib/fetcher";
import { invalidateAccountsAndSources } from "../../lib/swr";

type CalDAVProvider = "fastmail" | "icloud" | "caldav";

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function resolveUsernameInputType(provider: CalDAVProvider): string {
  if (provider === "caldav") return "text";
  return "email";
}

function resolvePasswordPlaceholder(provider: CalDAVProvider): string {
  if (provider === "caldav") return "CalDAV Server Password";
  return "App-Specific Password";
}

function resolveSubmitLabel(pending: boolean): string {
  if (pending) return "Connecting...";
  return "Connect";
}

const SERVER_URLS: Record<CalDAVProvider, string> = {
  fastmail: "https://caldav.fastmail.com/",
  icloud: "https://caldav.icloud.com/",
  caldav: "",
};

const EMAIL_PLACEHOLDERS: Record<CalDAVProvider, string> = {
  fastmail: "Fastmail Email Address",
  icloud: "Apple ID",
  caldav: "CalDAV Server Username",
};

interface CalendarOption {
  url: string;
  displayName: string;
}

interface CalDAVConnectFormProps {
  provider: CalDAVProvider;
}

export function CalDAVConnectForm({ provider }: CalDAVConnectFormProps) {
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const formRef = useRef<HTMLFormElement>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const serverUrl = formData.get("serverUrl") as string;
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

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

      const { calendars } = (await discoverResponse.json()) as { calendars: CalendarOption[] };

      if (calendars.length === 0) {
        setError("No calendars found");
        return;
      }

      let accountId: string | undefined;

      try {
        const responses: Response[] = [];
        for (const calendar of calendars) {
          const response = await apiFetch("/api/sources/caldav", {
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
          });
          responses.push(response);
        }

        const first = await responses[0]?.json();
        accountId = first?.accountId;
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
        {provider === "caldav" && (
          <Input
            name="serverUrl"
            defaultValue={SERVER_URLS[provider]}
            type="url"
            placeholder="CalDAV Server URL"
            required
          />
        )}
        {provider !== "caldav" && (
          <Input type="hidden" name="serverUrl" defaultValue={SERVER_URLS[provider]} />
        )}
        <Input
          name="username"
          type={resolveUsernameInputType(provider)}
          placeholder={EMAIL_PLACEHOLDERS[provider]}
          required
        />
        <Input
          name="password"
          type="password"
          placeholder={resolvePasswordPlaceholder(provider)}
          required
        />
      </div>
      {error && <Text size="sm" tone="danger">{error}</Text>}
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center" disabled={isPending}>
          {isPending && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{resolveSubmitLabel(isPending)}</ButtonText>
        </Button>
      </div>
    </form>
  );
}
