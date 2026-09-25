import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Input } from "@/components/ui/primitives/input";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { apiFetch } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";

export const Route = createFileRoute("/(oauth)/dashboard/connect/ews")({
  validateSearch: (search: Record<string, unknown>) => ({
    accountId: typeof search.accountId === "string" ? search.accountId : "",
  }),
  component: EwsConnectPage,
});
interface Folder {
  id: string;
  name: string;
  canRead: boolean;
  canWrite: boolean;
}
const advancedFields = [
  ["mailbox", "Mailbox to open (optional)"],
  ["impersonate", "Impersonated mailbox (optional)"],
  ["anchorMailbox", "Routing mailbox (optional)"],
] as const;
const limits = [
  [
    "syncIntervalSeconds",
    "Minimum time between syncs (seconds)",
    120,
    30,
    86_400,
  ],
  ["pageSize", "Results per request", 100, 1, 1000],
  ["maxRequests", "Maximum requests per sync", 1000, 1, 10_000],
  ["timeoutMs", "Request timeout (milliseconds)", 30_000, 1000, 120_000],
  ["minimumIntervalMs", "Delay between requests (milliseconds)", 100, 0, 60_000],
  [
    "maxResponseBytes",
    "Maximum response size (bytes)",
    8_388_608,
    1024,
    16_777_216,
  ],
] as const;

function EwsConnectPage() {
  const { accountId } = Route.useSearch();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();

  const [authType, setAuthType] = useState("oauth2-user");
  const [device, setDevice] = useState<{
    sessionId: string;
    userCode: string;
    verificationUri: string;
    expiresAt: number;
    interval: number;
  } | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!device || authorized) {return;}
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (Date.now() >= device.expiresAt)
          {throw new Error("Sign-in expired. Change a setting to restart.");}
        const response = await apiFetch("/api/sources/ews/oauth/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: device.sessionId }),
          signal: controller.signal,
        });
        if (!response.ok)
          {throw new Error(
            "Sign-in failed. Check application permissions and restart.",
          );}
        const result = (await response.json()) as {
          authorized: boolean;
          interval: number;
        };
        if (result.authorized) {
          const discovery = await apiFetch("/api/sources/ews/discover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: device.sessionId }),
            signal: controller.signal,
          });
          if (!discovery.ok)
            {throw new Error(
              "Signed in, but EWS discovery failed. Check mailbox access and EWS scopes.",
            );}
          const data = (await discovery.json()) as { calendars: Folder[] };
          if (!controller.signal.aborted) {
            setAuthorized(true);
            setFolders(data.calendars);
            if (data.calendars.length === 0)
              {setError("No readable calendars were found.");}
          }
        } else if (!controller.signal.aborted)
          {timer = setTimeout(poll, result.interval * 1000);}
      } catch {
        if (!controller.signal.aborted)
          {setError(
            "Sign-in or calendar discovery failed. Check settings and permissions, then restart sign-in.",
          );}
      }
    };
    timer = setTimeout(poll, device.interval * 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [device, authorized]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (folders.length > 0 && data.getAll("calendarIds").length === 0) {
      setError("Select at least one calendar before saving the connection.");
      return;
    }
    const value = (name: string) => String(data.get(name) ?? "");
    const auth: Record<string, string> = { type: authType };
    for (const key of [
      "username",
      "password",
      "tokenUrl",
      "deviceAuthorizationUrl",
      "clientId",
      "clientSecret",
      "scope",
    ]) {
      if (value(key)) {auth[key] = value(key);}
    }
    const config: Record<string, unknown> = {
      serverUrl: value("serverUrl"),
      auth,
      serverVersion: value("serverVersion"),
    };
    for (const [key] of advancedFields)
      {if (value(key)) config[key] = value(key);}
    for (const [key] of limits) {config[key] = Number(value(key));}
    setPending(true);
    setError("");
    try {
      if (authType === "oauth2-user" && !device) {
        const response = await apiFetch("/api/sources/ews/oauth/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        });
        if (!response.ok)
          {throw new Error(
            "Unable to start user sign-in. Check application settings.",
          );}
        setDevice(await response.json());
        return;
      }
      const discover = folders.length === 0;
      const response = await apiFetch(
        discover ? "/api/sources/ews/discover" : "/api/sources/ews",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(authType === "oauth2-user"
              ? { sessionId: device?.sessionId }
              : { config }),
            name: value("name"),
            calendarIds: data.getAll("calendarIds"),
            ...(accountId ? { accountId } : {}),
          }),
        },
      );
      if (!response.ok)
        {throw new Error(
          "Connection failed. Check settings, permissions and calendar selection.",
        );}
      if (discover) {
        const result = (await response.json()) as { calendars: Folder[] };
        setFolders(result.calendars);
        if (result.calendars.length === 0)
          {setError("No readable calendars were found.");}
      } else {
        await invalidateAccountsAndSources(mutate);
        await navigate({ to: "/dashboard/accounts" });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setPending(false);
    }
  }
  const field = (name: string, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm" key={name}>
      {label}
      <Input name={name} type={type} required autoComplete="off" />
    </label>
  );
  return (
    <>
      <Heading2 as="h1">
        {accountId ? "Reconnect Exchange EWS" : "Connect Exchange EWS"}
      </Heading2>
      <Text size="sm" tone="muted" align="left">
        Enter the endpoint and authentication details supplied by your server
        administrator. No provider is assumed.
      </Text>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4"
        onChange={(event) => {
          if (
            !(event.target instanceof HTMLInputElement) ||
            event.target.name !== "calendarIds"
          ) {
            setFolders([]);
            setDevice(null);
            setAuthorized(false);
            setError("");
          } else {
            setError("");
          }
        }}
      >
        <fieldset disabled={pending} className="flex flex-col gap-4">
          {field("name", "Connection name")}
          {field("serverUrl", "EWS HTTPS endpoint", "url")}
          <label className="flex flex-col gap-1 text-sm">
            Authentication
            <select
              value={authType}
              onChange={(event) => setAuthType(event.target.value)}
              className="border rounded p-2 bg-background"
            >
              <option value="ntlm">NTLM (username and password)</option>
              <option value="oauth2-user">OAuth2 user sign-in</option>
              <option value="oauth2-client-credentials">
                OAuth2 application credentials
              </option>
            </select>
          </label>
          {authType === "ntlm" ? (
            <>
              {field("username", String.raw`Username (email or DOMAIN\username)`)}
              {field("password", "Password", "password")}
            </>
          ) : (
            <>
          {authType === "oauth2-user" &&
            field(
              "deviceAuthorizationUrl",
              "OAuth2 device authorization endpoint",
              "url",
            )}
          {field("tokenUrl", "OAuth2 token endpoint", "url")}
          {field("clientId", "Application client ID")}
          {authType === "oauth2-client-credentials" ? (
            field("clientSecret", "Application client secret", "password")
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              Application client secret (optional for public clients)
              <Input name="clientSecret" type="password" autoComplete="off" />
            </label>
          )}
          {authType === "oauth2-user" && (
            <Text size="sm" tone="muted">
              Use delegated EWS scopes and request offline access. Your
              application must support device authorization. Sign in only with
              the mailbox you intend to connect.
            </Text>
          )}
          {field("scope", "Requested scopes")}
            </>
          )}
          {authType === "oauth2-user" &&
            field("mailbox", "Mailbox email address")}
          <details>
            <summary className="cursor-pointer text-sm">
              Advanced connection settings
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              {advancedFields
                .filter(
                  ([name]) => name !== "mailbox" || authType !== "oauth2-user",
                )
                .map(([name, label]) => (
                  <label key={name} className="flex flex-col gap-1 text-sm">
                    {label}
                    <Input
                      name={name}
                      autoComplete="off"
                      required={
                        name === "mailbox" && authType === "oauth2-user"
                      }
                    />
                  </label>
                ))}
              <label className="flex flex-col gap-1 text-sm">
                EWS schema version
                <select
                  name="serverVersion"
                  defaultValue="Exchange2013"
                  className="border rounded p-2 bg-background"
                >
                  {[
                    "Exchange2010_SP2",
                    "Exchange2013",
                    "Exchange2013_SP1",
                    "Exchange2016",
                  ].map((version) => (
                    <option key={version}>{version}</option>
                  ))}
                </select>
              </label>
              {limits.map(([name, label, initial, min, max]) => (
                <label key={name} className="flex flex-col gap-1 text-sm">
                  {label}
                  <Input
                    name={name}
                    type="number"
                    defaultValue={initial}
                    min={min}
                    max={max}
                    required
                  />
                </label>
              ))}
            </div>
          </details>
          {device && (
            <div className="flex flex-col gap-2 text-sm" aria-live="polite">
              {authorized ? (
                <p>Signed in. Select the calendars to connect.</p>
              ) : (
                <>
                  <p>Open the sign-in page and enter this code:</p>
                  <strong className="font-mono text-lg">
                    {device.userCode}
                  </strong>
                  <a
                    href={device.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Open sign-in page
                  </a>
                  <p>Waiting for sign-in…</p>
                </>
              )}
              <button
                type="button"
                className="underline text-left"
                onClick={() => {
                  setDevice(null);
                  setAuthorized(false);
                  setFolders([]);
                  setError("");
                }}
              >
                Restart sign-in
              </button>
            </div>
          )}
          {folders.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend>Select calendars</legend>
              <p className="text-sm">Select at least one calendar, then click Save connection.</p>
              {folders.map((folder) => (
                <label key={folder.id} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="calendarIds"
                    value={folder.id}
                    disabled={!folder.canRead}
                  />
                  {folder.name}
                  {!folder.canWrite && " (read only)"}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || (Boolean(device) && !authorized)}>
            <ButtonText>
              {pending
                ? "Connecting…"
                : folders.length > 0
                  ? "Save connection"
                  : authType === "oauth2-user" && !device
                    ? "Sign in"
                    : "Find calendars"}
            </ButtonText>
          </Button>
        </fieldset>
      </form>
      <Text size="sm" tone="muted" align="left">
        After connecting, choose synchronization directions, date ranges, copied
        fields and title prefixes in Keeper’s calendar settings. Copies do not
        send meeting invitations.
      </Text>
    </>
  );
}
