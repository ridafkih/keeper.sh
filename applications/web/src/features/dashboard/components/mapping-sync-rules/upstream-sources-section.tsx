import useSWR from "swr";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import { getDestinationSourcesKey } from "@/hooks/use-mapping-sync-rules";
import type { SetIncludeUpstreamSources } from "@/hooks/use-mapping-sync-rules";
import type { CalendarSource, DestinationSources, MappingSyncRules } from "@/types/api";
import { formatViaCalendars, listSourcesInheritedThrough } from "@/utils/inherited-sources";

interface UpstreamSourcesSectionProps {
  mapping: MappingSyncRules;
  sourceName: string;
  destinationName: string;
  calendars: CalendarSource[];
  onChange: SetIncludeUpstreamSources;
}

export function UpstreamSourcesSection({
  mapping,
  sourceName,
  destinationName,
  calendars,
  onChange,
}: UpstreamSourcesSectionProps) {
  const { data } = useSWR<DestinationSources>(
    getDestinationSourcesKey(mapping.destinationCalendarId),
  );
  const inheritedSources = mapping.includeUpstreamSources
    ? listSourcesInheritedThrough(data?.inheritedSources ?? [], mapping.sourceCalendarId, calendars)
    : [];

  return (
    <>
      <DashboardSection
        title="Inherited Events"
        description={`Also send ${destinationName} the events Keeper.sh syncs into ${sourceName} from other calendars. Each inherited calendar counts as a sync mapping.`}
      />
      <NavigationMenu>
        <NavigationMenuToggleItem
          checked={mapping.includeUpstreamSources}
          onCheckedChange={onChange}
        >
          <NavigationMenuItemLabel>Include Inherited Events</NavigationMenuItemLabel>
        </NavigationMenuToggleItem>
        {inheritedSources.map(({ calendar, viaCalendars }) => (
          <NavigationMenuItem key={calendar.id}>
            <NavigationMenuItemIcon>
              <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">{formatViaCalendars(viaCalendars)}</Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuItem>
        ))}
      </NavigationMenu>
    </>
  );
}
