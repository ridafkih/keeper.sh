import { useSetAtom } from "jotai";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import Check from "lucide-react/dist/esm/icons/check";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import {
  NavigationMenu,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Button, ButtonText, ExternalLinkButton } from "@/components/ui/primitives/button";
import { pluralize } from "@/lib/pluralize";
import { providerCalendarApp } from "@/lib/providers";
import { onboardingRunAtom } from "@/state/onboarding";
import { getCalendarProvider } from "@/utils/calendars";
import type { CalendarSource } from "@/types/api";
import type { SyncProposal } from "../sync-proposal";
import type { CopiedEvents } from "../use-copied-events";
import { OnboardingHeading } from "./onboarding-heading";
import { CopiedEventRows } from "./copied-event-rows";

const COPIED_PREVIEW_COUNT = 3;

const describeOutcome = ({ origin, destination, forward, backward }: SyncProposal<CalendarSource>): string => {
  if (forward && backward) return `${origin.name} and ${destination.name} now show you as busy at the same times.`;
  if (forward) return `${destination.name} now shows you as busy when ${origin.name} has an event.`;
  return `${origin.name} now shows you as busy when ${destination.name} has an event.`;
};

interface CopiedStepProps {
  copies: CopiedEvents;
  calendars: CalendarSource[];
  proposal: SyncProposal<CalendarSource> | null;
}

export function CopiedStep({ copies, calendars, proposal }: CopiedStepProps) {
  const setRun = useSetAtom(onboardingRunAtom);
  const destination = proposal?.forward ? proposal.destination : proposal?.origin;
  const calendarApp = destination ? providerCalendarApp(getCalendarProvider(destination)) : null;

  return (
    <>
      <OnboardingHeading
        icon={{ glyph: <Check size={22} strokeWidth={1.75} />, tone: "success" }}
        title={`${pluralize(copies.count, "event")} copied`}
        description={proposal ? describeOutcome(proposal) : "Your calendars now show you as busy at the same times."}
      />
      <NavigationMenu>
        <CopiedEventRows
          events={copies.upcoming.slice(0, COPIED_PREVIEW_COUNT)}
          calendars={calendars}
          showsCheck={false}
        />
        <NavigationMenuLinkItem to="/dashboard/events">
          <NavigationMenuItemIcon>
            <CalendarDays size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>View all events</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
      <Button className="w-full justify-center" onClick={() => setRun({ phase: "finished" })}>
        <ButtonText>Go to home</ButtonText>
      </Button>
      {calendarApp && (
        <ExternalLinkButton
          href={calendarApp.url}
          target="_blank"
          rel="noreferrer"
          variant="border"
          className="w-full justify-center"
        >
          <ExternalLink size={15} />
          <ButtonText>{calendarApp.label}</ButtonText>
        </ExternalLinkButton>
      )}
    </>
  );
}
