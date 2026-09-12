import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Input } from "@/components/ui/primitives/input";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { apiFetch } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";

export const Route = createFileRoute("/(oauth)/dashboard/connect/graph")({
  validateSearch: (search: Record<string, unknown>) => ({ accountId: typeof search.accountId === "string" ? search.accountId : "" }),
  component: GraphConnectPage,
});
interface DeviceSession {
  sessionId: string; userCode: string; verificationUri: string; expiresAt: number; interval: number;
}
function GraphConnectPage() {
  const { accountId } = Route.useSearch();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [clientId, setClientId] = useState("");
  const [tenant, setTenant] = useState("");
  const [scope, setScope] = useState("");
  const [device, setDevice] = useState<DeviceSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!accountId) {return;}
    const controller = new AbortController();
    void apiFetch(`/api/sources/graph?accountId=${encodeURIComponent(accountId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {return;}
        const config = await response.json() as { clientId?: string; tenant?: string; scope?: string };
        if (!controller.signal.aborted && config.clientId) {
          setClientId(config.clientId); setTenant(config.tenant ?? "common");
          if (config.scope) {setScope(config.scope);}
        }
      }).catch(() => {});
    return () => controller.abort();
  }, [accountId]);
  useEffect(() => {
    if (!device) {return;}
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (Date.now() >= device.expiresAt) {throw new Error("Sign-in expired. Start again.");}
        const response = await apiFetch("/api/sources/graph/oauth/poll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: device.sessionId }), signal: controller.signal,
        });
        if (!response.ok) {throw new Error("Microsoft sign-in failed. Check the application permissions and start again.");}
        const result = await response.json() as { authorized: boolean; interval: number };
        if (!result.authorized) { timer = setTimeout(poll, result.interval * 1000); return; }
        const saved = await apiFetch("/api/sources/graph", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: device.sessionId, ...(accountId ? { accountId } : {}) }), signal: controller.signal,
        });
        if (!saved.ok) {throw new Error("Signed in, but calendar connection failed. Check Graph permissions and the selected Microsoft account.");}
        const data = await saved.json() as { accountId: string };
        if (!controller.signal.aborted) {
          await invalidateAccountsAndSources(mutate);
          await navigate({ to: "/dashboard/accounts/$accountId/setup", params: { accountId: data.accountId } });
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Connection failed");
      }
    };
    timer = setTimeout(poll, device.interval * 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [device, accountId, mutate, navigate]);
  async function start(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const response = await apiFetch("/api/sources/graph/oauth/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { clientId: clientId.trim(), tenant: tenant.trim(), scope: scope.trim() } }),
      });
      if (!response.ok) {throw new Error("Unable to start sign-in. Check the Client ID, tenant and public client flow setting.");}
      setDevice(await response.json());
    } catch (error) { setError(error instanceof Error ? error.message : "Connection failed"); }
    finally { setPending(false); }
  }
  return <>
    <Heading2 as="h1">Connect Microsoft Graph</Heading2>
    <Text size="sm" tone="muted" align="left">Choose the Microsoft application used for this connection. For your own application, enable public client flows and delegated Calendars.ReadWrite and User.Read permissions. Set the OAuth scopes supported by your application.</Text>
    <form onSubmit={start} className="flex flex-col gap-4">
      <fieldset disabled={pending || Boolean(device)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">Application Client ID<Input required value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" /></label>
        <label className="flex flex-col gap-1 text-sm">Tenant ID or domain<Input required value={tenant} onChange={(event) => setTenant(event.target.value)} autoComplete="off" /></label>
        <Text size="sm" tone="muted" align="left">Use common for personal and work accounts, organizations for work accounts, or your tenant ID/domain. Sign in with the mailbox you want to synchronize.</Text>
        <label className="flex flex-col gap-1 text-sm">OAuth scopes<Input required value={scope} onChange={(event) => setScope(event.target.value)} autoComplete="off" /></label>
        <Text size="sm" tone="muted" align="left">Enter the space-separated OAuth scopes configured for your application.</Text>
        <Button type="submit"><ButtonText>{pending ? "Connecting…" : "Sign in with Microsoft"}</ButtonText></Button>
      </fieldset>
    </form>
    {device && <div className="flex flex-col gap-2 text-sm" aria-live="polite">
      <p>Enter this code on the Microsoft sign-in page:</p>
      <strong className="font-mono text-lg">{device.userCode}</strong>
      <a href={device.verificationUri} target="_blank" rel="noopener noreferrer" className="underline">Open Microsoft sign-in</a>
      <p>After approval, Keeper will connect your calendars. You will then choose your synchronization settings.</p>
      <Button onClick={() => { setDevice(null); setError(""); }}><ButtonText>Restart sign-in</ButtonText></Button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </>;
}
