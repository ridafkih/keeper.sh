import { useState } from "react";
import { useSetAtom } from "jotai";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { navigationMenuItemIconStyle } from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import { useIcalFeeds } from "@/hooks/use-ical-feeds";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { chosenDestinationIdAtom } from "@/state/onboarding";
import { showToastAtom } from "@/state/toast";
import { getCalendarProvider } from "@/utils/calendars";
import type { CalendarSource } from "@/types/api";
import { resolveDestinationPrompt } from "../destination-prompt";
import type { DestinationPrompt } from "../destination-prompt";
import { OnboardingHeading } from "./onboarding-heading";
import { ProviderOptions } from "./provider-options";

interface AddDestinationStepProps {
  calendars: CalendarSource[];
  origin: CalendarSource;
  sameAccountDestinations: CalendarSource[];
}

const READ_ONLY_DESCRIPTIONS: Record<"read-only-links" | "read-only", (origin: CalendarSource) => string> = {
  "read-only": (origin) =>
    `${origin.name} is read-only, so it can't receive events. Connect the calendar that should show your busy time.`,
  "read-only-links": () =>
    "Calendar links are read-only, so they can't receive events. Connect the calendar that should show your busy time.",
};

function describePrompt(prompt: DestinationPrompt<CalendarSource>, origin: CalendarSource): string {
  if (prompt.kind === "same-account") {
    return `Keeper.sh can copy events from ${origin.name} into another calendar on this account, or into one you connect.`;
  }
  if (prompt.kind === "connect") {
    return `Keeper.sh copies events from ${origin.name} into a second calendar. Connect the one that should show you as busy.`;
  }
  return READ_ONLY_DESCRIPTIONS[prompt.kind](origin);
}

function isReadOnlyPrompt(prompt: DestinationPrompt<CalendarSource>): boolean {
  return prompt.kind === "read-only-links" || prompt.kind === "read-only";
}

export function AddDestinationStep({ calendars, origin, sameAccountDestinations }: AddDestinationStepProps) {
  const chooseDestination = useSetAtom(chosenDestinationIdAtom);
  const prompt = resolveDestinationPrompt(calendars, sameAccountDestinations);

  const chooseSameAccount = (calendar: CalendarSource) => {
    track(ANALYTICS_EVENTS.onboarding_destination_chosen, { destination_path: "same_account" });
    chooseDestination(calendar.id);
  };

  return (
    <>
      <OnboardingHeading
        title="Where should your busy time show?"
        description={describePrompt(prompt, origin)}
      />
      {prompt.kind === "same-account" ? (
        <NavigationMenu>
          {prompt.destinations.map((calendar) => (
            <NavigationMenuButtonItem key={calendar.id} onClick={() => chooseSameAccount(calendar)}>
              <NavigationMenuItemIcon>
                <ProviderIcon provider={getCalendarProvider(calendar)} calendarType={calendar.calendarType} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing indicator={<ArrowRight size={15} className={navigationMenuItemIconStyle()} />} />
            </NavigationMenuButtonItem>
          ))}
        </NavigationMenu>
      ) : (
        <NavigationMenu>
          <NavigationMenuItem>
            <NavigationMenuItemIcon>
              <ProviderIcon provider={getCalendarProvider(origin)} calendarType={origin.calendarType} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel tone="default">{origin.name}</NavigationMenuItemLabel>
          </NavigationMenuItem>
        </NavigationMenu>
      )}
      <ProviderOptions step="add-destination" includeCalendarLinks={!isReadOnlyPrompt(prompt)} />
      <SubscribeLinkOption />
    </>
  );
}

function SubscribeLinkOption() {
  const { data: feeds } = useIcalFeeds();
  const showToast = useSetAtom(showToastAtom);
  const [copied, setCopied] = useState(false);
  const feed = feeds?.find(({ isDefault }) => isDefault) ?? feeds?.[0];

  const copyLink = async () => {
    if (!feed) return;
    await navigator.clipboard.writeText(feed.icalUrl);
    track(ANALYTICS_EVENTS.onboarding_destination_chosen, { destination_path: "ical_link" });
    track(ANALYTICS_EVENTS.ical_link_copied);
    setCopied(true);
    showToast("Link copied");
  };

  return (
    <NavigationMenu>
      <NavigationMenuButtonItem onClick={feed ? copyLink : undefined} disabled={!feed}>
        <NavigationMenuItemIcon>
          <Link2 size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Subscribe with a link instead</NavigationMenuItemLabel>
        <NavigationMenuItemTrailing indicator={copied ? <Check size={15} className="shrink-0" /> : <Copy size={15} className="shrink-0" />} />
      </NavigationMenuButtonItem>
    </NavigationMenu>
  );
}
