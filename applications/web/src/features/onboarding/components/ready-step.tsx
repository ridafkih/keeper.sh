import { useEffect, useState, useTransition } from "react";
import { useSetAtom, useStore } from "jotai";
import { useSWRConfig } from "swr";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import {
  NavigationMenu,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Button, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import { USAGE_CACHE_KEY } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { onboardingRunAtom } from "@/state/onboarding";
import { syncStateAtom } from "@/state/sync";
import { showToastAtom } from "@/state/toast";
import { getCalendarProvider } from "@/utils/calendars";
import { resolveErrorMessage } from "@/utils/errors";
import type { CalendarSource } from "@/types/api";
import type { SyncProposal } from "../sync-proposal";
import { describeProposal } from "../sync-pairs";
import { planSyncStart, startSync } from "../start-sync";
import type { SyncChoice } from "../start-sync";
import { OnboardingHeading } from "./onboarding-heading";

interface ReadyStepProps {
  proposal: SyncProposal<CalendarSource>;
}

export function ReadyStep({ proposal }: ReadyStepProps) {
  const { origin, destination } = proposal;
  const store = useStore();
  const setRun = useSetAtom(onboardingRunAtom);
  const showToast = useSetAtom(showToastAtom);
  const { mutate } = useSWRConfig();
  const [isStarting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<SyncChoice>({
    backward: proposal.backward,
    busyOnly: true,
    forward: proposal.forward,
  });

  useEffect(() => {
    track(ANALYTICS_EVENTS.onboarding_sync_proposed, {
      busy_only: true,
      mapping_directions: proposal.forward && proposal.backward ? "both" : "one",
    });
  }, [proposal.forward, proposal.backward]);

  const edit = (field: keyof SyncChoice, enabled: boolean) => {
    track(ANALYTICS_EVENTS.onboarding_sync_edited, { enabled, field });
    setChoice((current) => ({ ...current, [field]: enabled }));
  };

  const plan = planSyncStart(proposal, choice);

  const start = () => {
    setError(null);
    startTransition(async () => {
      const startedAfterSeq = store.get(syncStateAtom).mappings?.seq ?? 0;
      try {
        await startSync(plan);
      } catch (startError) {
        setError(resolveErrorMessage(startError, "Syncing couldn't start. Try again."));
        return;
      }
      track(ANALYTICS_EVENTS.onboarding_sync_started, {
        busy_only: choice.busyOnly,
        mapping_count: plan.mappings.length,
      });
      setRun({ phase: "started", startedAfterSeq });
      showToast("Sync started");
      await Promise.all([mutate(USAGE_CACHE_KEY), mutate("/api/mappings")]);
    });
  };

  return (
    <>
      <OnboardingHeading title="Ready to sync" description={describeProposal(proposal)} />
      <NavigationMenu>
        {proposal.forward && (
          <NavigationMenuToggleItem checked={choice.forward} onCheckedChange={(enabled) => edit("forward", enabled)}>
            <NavigationMenuItemIcon>
              <ProviderIcon provider={getCalendarProvider(origin)} calendarType={origin.calendarType} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Copy {origin.name} to {destination.name}</NavigationMenuItemLabel>
          </NavigationMenuToggleItem>
        )}
        {proposal.backward && (
          <NavigationMenuToggleItem checked={choice.backward} onCheckedChange={(enabled) => edit("backward", enabled)}>
            <NavigationMenuItemIcon>
              <ProviderIcon provider={getCalendarProvider(destination)} calendarType={destination.calendarType} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Copy {destination.name} to {origin.name}</NavigationMenuItemLabel>
          </NavigationMenuToggleItem>
        )}
        <NavigationMenuToggleItem checked={choice.busyOnly} onCheckedChange={(enabled) => edit("busyOnly", enabled)}>
          <NavigationMenuItemIcon>
            <EyeOff size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Busy only</NavigationMenuItemLabel>
        </NavigationMenuToggleItem>
      </NavigationMenu>
      <Button
        className="w-full justify-center"
        disabled={plan.mappings.length === 0 || isStarting}
        onClick={start}
      >
        {isStarting && <LoaderCircle size={16} className="animate-spin" />}
        <ButtonText>Start syncing</ButtonText>
      </Button>
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
      <LinkButton
        to={`/dashboard/accounts/${origin.accountId}/${origin.id}`}
        variant="ghost"
        className="w-full justify-center"
      >
        <ButtonText>Choose other calendars</ButtonText>
      </LinkButton>
    </>
  );
}
