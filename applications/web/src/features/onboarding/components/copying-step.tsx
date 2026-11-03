import { useAtomValue } from "jotai";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ShimmerText } from "@/components/ui/primitives/shimmer-text";
import { SyncProgressCircle } from "@/features/dashboard/components/sync-status";
import { syncStateAtom } from "@/state/sync";
import type { CalendarSource } from "@/types/api";
import type { CopiedEvents } from "../use-copied-events";
import { describeRemainingEvents, describeTimeLeft, resolveCopyPercent } from "../copy-progress";
import { useCopyProgress } from "../use-copy-progress";
import { OnboardingHeading } from "./onboarding-heading";
import { CopiedEventRows } from "./copied-event-rows";

interface CopyingStepProps {
  copies: CopiedEvents | null;
  calendars: CalendarSource[];
}

export function CopyingStep({ copies, calendars }: CopyingStepProps) {
  const sync = useAtomValue(syncStateAtom);
  const progress = useCopyProgress();
  const remainingLabel = describeRemainingEvents(progress);

  return (
    <>
      <OnboardingHeading title="Copying your events" description={describeTimeLeft(progress?.secondsRemaining ?? null)} />
      <NavigationMenu>
        <CopiedEventRows events={copies?.upcoming ?? []} calendars={calendars} showsCheck />
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <SyncProgressCircle percent={resolveCopyPercent(progress) ?? 0} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            {sync.state === "syncing" ? <ShimmerText>{remainingLabel}</ShimmerText> : remainingLabel}
          </NavigationMenuItemLabel>
        </NavigationMenuItem>
      </NavigationMenu>
    </>
  );
}
