import { useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Divider } from "@/components/ui/primitives/divider";
import { Input } from "@/components/ui/primitives/input";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { apiFetch } from "@/lib/fetcher";
import { providerAppPasswordUrl, providerAuthorizeId } from "@/lib/providers";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { resolveErrorMessage } from "@/utils/errors";
import type { CalendarAccount } from "@/types/api";

export const Route = createFileRoute("/(dashboard)/dashboard/accounts/$accountId/reconnect")({
  component: ReconnectAccountPage,
});

/**
 * Restoring access is not the same as connecting: the account already exists, and the flow
 * has to repair that row rather than create a second one. OAuth hands back to the provider
 * pinned to this account; CalDAV replaces the stored password in place.
 */
function ReconnectAccountPage() {
  const { accountId } = Route.useParams();
  const { data: account, isLoading, error, mutate } = useSWR<CalendarAccount>(
    `/api/accounts/${accountId}`,
  );

  if (error) {
    return (
      <RouteShell
        backFallback={`/dashboard/accounts/${accountId}`}
        status="error"
        onRetry={async () => {
          await mutate();
        }}
      />
    );
  }

  if (isLoading || !account) {
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="loading" />;
  }

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback={`/dashboard/accounts/${accountId}`} />
        <DashboardHeading1>Restore access</DashboardHeading1>
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {account.authType === "caldav" ? (
          <CalDAVReconnect account={account} />
        ) : (
          <OAuthReconnect account={account} />
        )}
      </PageBody>
    </div>
  );
}

function OAuthReconnect({ account }: { account: CalendarAccount }) {
  const authorizeProvider = providerAuthorizeId(account.provider);

  if (!authorizeProvider) {
    return (
      <Text size="sm" tone="danger" className="px-0.5">
        {account.providerName} accounts cannot be reconnected automatically. Remove the account
        and add it again.
      </Text>
    );
  }

  // A full page load, not a client navigation: the response is a redirect to the provider.
  const handleReconnect = () => {
    const search = new URLSearchParams({
      provider: authorizeProvider,
      accountId: account.id,
    });
    window.location.href = `/api/sources/authorize?${search.toString()}`;
  };

  return (
    <>
      <DashboardSection
        title="Reconnect with the provider"
        description={`Keeper.sh lost authorization for ${account.accountLabel}. Signing in again restores it — you will be asked to grant the same permissions, and no calendars or settings are lost.`}
      />
      <Button onClick={handleReconnect} className="w-full justify-center">
        <ButtonText>Continue to {account.providerName}</ButtonText>
      </Button>
      <Text size="sm" tone="muted" className="px-0.5">
        Sign in as {account.accountLabel}. Choosing a different account will connect that one
        instead, and leave this account disconnected.
      </Text>
    </>
  );
}

function CalDAVReconnect({ account }: { account: CalendarAccount }) {
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const appPasswordUrl = providerAppPasswordUrl(account.provider);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const password = new FormData(event.currentTarget).get("password");
    if (typeof password !== "string" || password.length === 0) {
      setError("A password is required");
      return;
    }

    startTransition(async () => {
      try {
        await apiFetch(`/api/accounts/${account.id}/reconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
      } catch (err) {
        setError(resolveErrorMessage(err, "Those credentials were rejected"));
        return;
      }

      await invalidateAccountsAndSources(globalMutate, `/api/accounts/${account.id}`);
      navigate({ to: "/dashboard/accounts/$accountId", params: { accountId: account.id } });
    });
  };

  return (
    <>
      <DashboardSection
        title="Enter a new app password"
        description="The server and username stay as they are — only the password is replaced. We check it against the server before saving it."
      />
      {appPasswordUrl && (
        <Text size="sm" tone="muted" className="px-0.5">
          Changing your account password revokes every app-specific password.{" "}
          <ExternalTextLink href={appPasswordUrl}>Generate a new one</ExternalTextLink>, then
          paste it below.
        </Text>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Input
            name="serverUrl"
            type="url"
            defaultValue={account.caldavServerUrl ?? ""}
            disabled
            readOnly
          />
          <Input
            name="username"
            type="text"
            defaultValue={account.caldavUsername ?? account.accountLabel}
            disabled
            readOnly
          />
          <Input
            name="password"
            type="password"
            placeholder="App-Specific Password"
            autoFocus
            required
          />
        </div>
        {error && <Text size="sm" tone="danger">{error}</Text>}
        <Divider />
        <Button type="submit" className="w-full justify-center" disabled={isPending}>
          {isPending && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{isPending ? "Checking…" : "Restore access"}</ButtonText>
        </Button>
      </form>
    </>
  );
}
