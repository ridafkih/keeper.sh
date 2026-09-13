import CheckIcon from "lucide-react/dist/esm/icons/check";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { CONNECT_PROVIDERS } from "@/lib/connect-providers";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { canPull, canPush } from "@/utils/calendars";
import type { CalendarSource } from "@/types/api";
import { ConnectProviderIcon } from "@/components/ui/primitives/connect-provider-icon";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import type { SetupBlank } from "../setup-draft";

interface CalendarOptionsProps {
  blank: SetupBlank;
  calendars: CalendarSource[];
  excludeIds: string[];
  selectedId: string | null;
  onSelect: (calendarId: string) => void;
  onConnect: () => void;
}

const fits = (blank: SetupBlank, calendar: CalendarSource): boolean =>
  blank.kind === "from" ? canPull(calendar) : canPush(calendar);

export function CalendarOptions({ blank, calendars, excludeIds, selectedId, onSelect, onConnect }: CalendarOptionsProps) {
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.accounts);
  const options = calendars.filter((calendar) => fits(blank, calendar) && !excludeIds.includes(calendar.id));
  const providers = CONNECT_PROVIDERS.filter((provider) => blank.kind === "from" || !provider.pullOnly);

  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 0 && (
        <NavigationMenu>
          {options.map((calendar) => (
            <NavigationMenuButtonItem key={calendar.id} onClick={() => onSelect(calendar.id)}>
              <NavigationMenuItemIcon>
                <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing className="shrink-0 grow-0 max-w-[45%]">
                <Text size="sm" tone="muted" align="right" className="min-w-0 truncate">
                  {calendar.accountLabel}
                </Text>
                {calendar.id === selectedId && <CheckIcon size={14} className="shrink-0 text-foreground" />}
              </NavigationMenuItemTrailing>
            </NavigationMenuButtonItem>
          ))}
        </NavigationMenu>
      )}
      <NavigationMenu>
        <NavigationMenuItem>
          <Text size="xs" tone="muted">Connect</Text>
        </NavigationMenuItem>
        {providers.map((provider) => (
          <div
            key={provider.id}
            data-visitors-event={ANALYTICS_EVENTS.calendar_connect_started}
            data-visitors-provider={provider.analyticsProvider}
            onPointerDown={atLimit ? undefined : onConnect}
          >
            <NavigationMenuLinkItem to={provider.to} disabled={atLimit}>
              <NavigationMenuItemIcon>
                <ConnectProviderIcon provider={provider} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{provider.label}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing />
            </NavigationMenuLinkItem>
          </div>
        ))}
      </NavigationMenu>
      {atLimit && <PremiumHint>Account limit reached.</PremiumHint>}
    </div>
  );
}
