import { useAtomValue } from "jotai";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { SyncProgressCircle } from "@/features/dashboard/components/sync-status";
import { resolveSyncPercent } from "@/features/dashboard/components/sync-status-helpers";
import { pluralize } from "@/lib/pluralize";
import { syncStateAtom } from "@/state/sync";
import type { CalendarSource } from "@/types/api";
import type { CopiedEvents } from "../use-copied-events";
import { OnboardingHeading } from "./onboarding-heading";
import { CopiedEventRows } from "./copied-event-rows";

interface CopyingStepProps {
  copies: CopiedEvents | null;
  calendars: CalendarSource[];
}

const resolveRemainingLabel = (remaining: number): string => {
  if (remaining > 0) return pluralize(remaining, "more event");
  return "Copying";
};

export function CopyingStep({ copies, calendars }: CopyingStepProps) {
  const sync = useAtomValue(syncStateAtom);
  const percent = resolveSyncPercent(sync) ?? 0;

  return (
    <>
      <OnboardingHeading title="Copying your events" description="Usually done in about a minute." />
      <NavigationMenu>
        <CopiedEventRows events={copies?.upcoming ?? []} calendars={calendars} showsCheck />
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <SyncProgressCircle percent={percent} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{resolveRemainingLabel(sync.syncEventsRemaining)}</NavigationMenuItemLabel>
        </NavigationMenuItem>
      </NavigationMenu>
    </>
  );
}
