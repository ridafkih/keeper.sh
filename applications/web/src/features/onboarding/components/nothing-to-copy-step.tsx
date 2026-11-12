import { useEffect } from "react";
import { useSetAtom } from "jotai";
import Clock from "lucide-react/dist/esm/icons/clock";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Button, ButtonText, ExternalLinkButton } from "@/components/ui/primitives/button";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { providerCalendarApp } from "@/lib/providers";
import { onboardingRunAtom } from "@/state/onboarding";
import { getCalendarProvider } from "@/utils/calendars";
import type { CalendarSource } from "@/types/api";
import type { SyncProposal } from "../sync-proposal";
import { useSyncPairs } from "../use-sync-pairs";
import { OnboardingHeading } from "./onboarding-heading";
import { SyncPairRow } from "./sync-pair-row";

interface NothingToCopyStepProps {
  proposal: SyncProposal<CalendarSource>;
  calendars: CalendarSource[];
}

export function NothingToCopyStep({ proposal, calendars }: NothingToCopyStepProps) {
  const setRun = useSetAtom(onboardingRunAtom);
  const source = proposal.forward ? proposal.origin : proposal.destination;
  const calendarApp = providerCalendarApp(getCalendarProvider(source));
  const pairs = useSyncPairs(calendars);

  useEffect(() => {
    track(ANALYTICS_EVENTS.onboarding_first_run_empty, { sync_events_in_range: 0 });
  }, []);

  return (
    <>
      <OnboardingHeading
        icon={{ glyph: <Clock size={22} strokeWidth={1.75} />, tone: "neutral" }}
        title="Nothing to copy yet"
        description={`${source.name} has no upcoming events. New events copy within a few minutes of being added.`}
      />
      {pairs.length > 0 && (
        <NavigationMenu>
          {pairs.map(({ pair, source: pairSource }) => (
            <SyncPairRow key={pair.key} pair={pair} source={pairSource} />
          ))}
        </NavigationMenu>
      )}
      {calendarApp && (
        <ExternalLinkButton
          href={calendarApp.url}
          target="_blank"
          rel="noreferrer"
          className="w-full justify-center"
        >
          <ExternalLink size={15} />
          <ButtonText>Add a test event</ButtonText>
        </ExternalLinkButton>
      )}
      <Button variant="ghost" className="w-full justify-center" onClick={() => setRun({ phase: "finished" })}>
        <ButtonText>Go to home</ButtonText>
      </Button>
    </>
  );
}
