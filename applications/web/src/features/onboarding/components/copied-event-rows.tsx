import Check from "lucide-react/dist/esm/icons/check";
import {
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import { formatClock } from "@/lib/time";
import { getCalendarProvider } from "@/utils/calendars";
import type { CalendarSource } from "@/types/api";
import type { CopiedEvent } from "../use-copied-events";

const formatCopyTime = (startTime: string): string => {
  const start = new Date(startTime);
  const weekday = start.toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday} ${formatClock(start)}`;
};

interface CopiedEventRowsProps {
  events: CopiedEvent[];
  calendars: CalendarSource[];
  showsCheck: boolean;
}

export function CopiedEventRows({ events, calendars, showsCheck }: CopiedEventRowsProps) {
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));

  return events.map((event) => {
    const source = event.sourceCalendarId ? calendarsById.get(event.sourceCalendarId) : undefined;
    return (
      <NavigationMenuItem key={event.id}>
        <NavigationMenuItemIcon>
          <ProviderIcon
            provider={source ? getCalendarProvider(source) : undefined}
            calendarType={source?.calendarType}
          />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel tone="default">{event.title ?? "Busy"}</NavigationMenuItemLabel>
        <NavigationMenuItemTrailing
          indicator={showsCheck ? <Check size={15} className="shrink-0 text-foreground" /> : undefined}
        >
          <Text size="sm" tone="muted" className="shrink-0 tabular-nums">{formatCopyTime(event.startTime)}</Text>
        </NavigationMenuItemTrailing>
      </NavigationMenuItem>
    );
  });
}
