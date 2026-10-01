import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { ConnectProviderIcon } from "@/components/ui/primitives/connect-provider-icon";
import { Heading2 } from "@/components/ui/primitives/heading";
import { MenuHint, PremiumGate } from "@/components/ui/primitives/menu-hint";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { CONNECT_PROVIDERS, CONNECT_PROVIDER_GROUPS, type ConnectProvider } from "@/lib/connect-providers";
import { invalidateAccountsAndSources } from "@/lib/swr";
import type { CalendarSource } from "@/types/api";
import { useLoginImport } from "@/features/setup/use-login-import";
import { canStartFirstSync, connectLabel, groupConnectedAccounts } from "../onboarding-accounts";

// Accounts first: almost everyone starts from Google or Outlook, and feeds are a read-only extra.
const GROUP_ORDER = ["account", "server", "feed"] as const;

const blockedReason = (sources: readonly CalendarSource[]): string => {
  if (sources.length < 2) return "Connect a second calendar so Keeper has somewhere to copy events.";
  return "Connect a calendar Keeper can write to. Feeds are read-only.";
};

interface ConnectStepProps {
  accountId?: string;
  error?: string;
  onContinue: () => void;
  onImported: (accountId: string) => void;
}

export function ConnectStep({ accountId, error, onContinue, onImported }: ConnectStepProps) {
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const [blocked, setBlocked] = useState<string | null>(null);
  const accounts = groupConnectedAccounts(sources ?? []);
  const atLimit = !canAddMore(entitlements?.accounts);

  const imported = useCallback(async (importedAccountId: string) => {
    await invalidateAccountsAndSources(globalMutate);
    onImported(importedAccountId);
  }, [globalMutate, onImported]);
  useLoginImport(sources?.length === 0 && !accountId, imported);

  const connect = (provider: ConnectProvider) => {
    track(ANALYTICS_EVENTS.calendar_connect_started, { provider: provider.analyticsProvider, source: "onboarding" });
    void navigate({ href: `${provider.to}?returnTo=onboarding` });
  };

  const next = () => {
    if (!sources || !canStartFirstSync(sources)) {
      setBlocked(blockedReason(sources ?? []));
      return;
    }
    onContinue();
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-1.5">
      <div className="flex flex-col gap-1 px-0.5 pb-3">
        <Heading2 as="h1">Connect Your Calendars</Heading2>
        <Text size="sm" tone="muted">Connect the calendars you want to keep in step. You need at least two.</Text>
      </div>
      {accounts.length > 0 && (
        <NavigationMenu>
          {accounts.map((account) => (
            <NavigationMenuItem key={account.accountId}>
              <NavigationMenuItemIcon>
                <ProviderIcon provider={account.provider} />
              </NavigationMenuItemIcon>
              <div className="flex min-w-0 flex-col">
                <Text size="sm" tone="default" className="truncate">{account.label}</Text>
                <Text size="xs" tone="muted" className="truncate">{account.calendarNames.join(", ")}</Text>
              </div>
              <NavigationMenuItemTrailing indicator={<CircleCheck size={16} className="shrink-0 text-emerald-500" />} />
            </NavigationMenuItem>
          ))}
        </NavigationMenu>
      )}
      <PremiumGate locked={atLimit} hint="Free plans include two accounts.">
        {GROUP_ORDER.filter((group) => CONNECT_PROVIDER_GROUPS.includes(group)).map((group) => (
          <NavigationMenu key={group}>
            {CONNECT_PROVIDERS.filter((provider) => provider.group === group).map((provider) => (
              <NavigationMenuButtonItem key={provider.id} disabled={atLimit} onClick={() => connect(provider)}>
                <NavigationMenuItemIcon>
                  <ConnectProviderIcon provider={provider} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{connectLabel(provider, accounts)}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing />
              </NavigationMenuButtonItem>
            ))}
          </NavigationMenu>
        ))}
      </PremiumGate>
      {error && <MenuHint tone="attention">That calendar didn&apos;t connect. Try again, or pick another one.</MenuHint>}
      {blocked && <MenuHint tone="attention">{blocked}</MenuHint>}
      <Button className="mt-3 w-full justify-center" onClick={next}>
        <ButtonText>Continue</ButtonText>
      </Button>
    </div>
  );
}
