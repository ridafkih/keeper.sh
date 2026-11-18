import useSWR from "swr";
import {
  NavigationMenu,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import { getSourceDestinationsKey } from "@/hooks/use-mapping-sync-rules";
import type { CalendarSource, SourceDestinations } from "@/types/api";
import { formatDestinationRulesState } from "@/utils/mapping-sync-rules";

interface DestinationRulesSectionProps {
  accountId: string;
  calendarId: string;
}

export function DestinationRulesSection({ accountId, calendarId }: DestinationRulesSectionProps) {
  const { data: destinations } = useSWR<SourceDestinations>(getSourceDestinationsKey(calendarId));
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");

  const mappedIds = new Set(destinations?.destinationIds);
  const customizedIds = new Set(destinations?.customizedDestinationIds);
  const mappedCalendars = (calendars ?? []).filter((calendar) => mappedIds.has(calendar.id));

  if (mappedCalendars.length === 0) return null;

  return (
    <>
      <DashboardSection
        title="Customize per Calendar"
        description="Sync this calendar differently to each destination, such as showing event names in one and hiding them in another."
      />
      <NavigationMenu>
        {mappedCalendars.map((calendar) => (
          <DestinationRulesLinkItem
            key={calendar.id}
            to={`/dashboard/accounts/${accountId}/${calendarId}/destinations/${calendar.id}`}
            calendar={calendar}
            customized={customizedIds.has(calendar.id)}
          />
        ))}
      </NavigationMenu>
    </>
  );
}

function DestinationRulesLinkItem({
  to,
  calendar,
  customized,
}: {
  to: string;
  calendar: CalendarSource;
  customized: boolean;
}) {
  return (
    <NavigationMenuLinkItem to={to}>
      <NavigationMenuItemIcon>
        <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        <Text size="sm" tone={customized ? "default" : "muted"}>
          {formatDestinationRulesState(customized)}
        </Text>
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  );
}
