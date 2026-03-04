import { useState } from "react";
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

  const [serverUrl, setServerUrl] = useState(SERVER_URLS[provider]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const discoverResponse = await apiFetch("/api/sources/caldav/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverUrl, username, password }),
    }).catch(() => null);

    if (!discoverResponse) {
      setLoading(false);
      setError("Failed to discover calendars");
      return;
    }

    const { calendars } = (await discoverResponse.json()) as { calendars: CalendarOption[] };

    if (calendars.length === 0) {
      setLoading(false);
      setError("No calendars found");
      return;
    }

    for (const calendar of calendars) {
      try {
        await apiFetch("/api/sources/caldav", {
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
      } catch {
        setLoading(false);
        setError(`Failed to import ${calendar.displayName}`);
        return;
      }
    }

    setLoading(false);
    await invalidateAccountsAndSources(globalMutate);
    navigate({ to: "/dashboard" });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {provider === "caldav" && (
          <Input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            type="url"
            placeholder="CalDAV Server URL"
            required
          />
        )}
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          type={provider === "caldav" ? "text" : "email"}
          placeholder={EMAIL_PLACEHOLDERS[provider]}
          required
        />
        <Input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder={provider === "caldav" ? "CalDAV Server Password" : "App-Specific Password"}
          required
        />
      </div>
      {error && <Text size="sm" tone="danger">{error}</Text>}
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center" disabled={loading}>
          {loading && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{loading ? "Connecting..." : "Connect"}</ButtonText>
        </Button>
      </div>
    </form>
  );
}
