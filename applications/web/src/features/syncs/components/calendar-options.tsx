import CheckIcon from "lucide-react/dist/esm/icons/check";
import type { SyncCalendarRole } from "@keeper.sh/data-schemas";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { CONNECT_PROVIDERS } from "@/lib/connect-providers";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";
import { ConnectProviderIcon } from "@/components/ui/primitives/connect-provider-icon";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { fitsRole } from "../sync-draft";
import { SelectableItem } from "./selectable-item";

export interface CalendarCapacity {
  // How many calendars this end can hold.
  max: number;
  // Whether the plan, not the schema, sets that number.
  byPlan: boolean;
}

interface CalendarOptionsProps {
  role: SyncCalendarRole;
  calendars: CalendarSource[];
  selectedIds: string[];
  // Calendars on the other end of a one-way sync, which can't also sit on this end.
  otherEndIds: string[];
  capacity: CalendarCapacity;
  onToggle: (calendarId: string) => void;
  onConnect?: () => void;
}

const UNFIT_REASON: Record<SyncCalendarRole, string> = {
  destination: "Read-only",
  member: "Needs to send and receive",
  source: "Can't be read",
};

export function CalendarOptions({ role, calendars, selectedIds, otherEndIds, capacity, onToggle, onConnect }: CalendarOptionsProps) {
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.accounts);
  const providers = CONNECT_PROVIDERS.filter((provider) => role === "source" || !provider.pullOnly);
  const full = selectedIds.length >= capacity.max;
  // Remembers which blank the user left from, for mouse, touch and keyboard alike.
  const connect = () => {
    if (!atLimit) onConnect?.();
  };
  const where = role === "member" ? "This sync" : "This end";

  return (
    <div className="flex flex-col gap-1.5">
      {calendars.length > 0 && (
        <NavigationMenu>
          {calendars.map((calendar) => {
            const selected = selectedIds.includes(calendar.id);
            const reason = fitsRole(calendar, role) ? null : UNFIT_REASON[role];
            return (
              <SelectableItem
                key={calendar.id}
                role="checkbox"
                checked={selected}
                disabled={reason !== null || (full && !selected)}
                onSelect={() => onToggle(calendar.id)}
              >
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0 max-w-[45%]">
                  <Text size="sm" tone="muted" align="right" className="min-w-0 truncate">
                    {reason ?? (otherEndIds.includes(calendar.id) ? "Moves here" : calendar.accountLabel)}
                  </Text>
                  {selected && <CheckIcon size={14} className="shrink-0 text-foreground" />}
                </NavigationMenuItemTrailing>
              </SelectableItem>
            );
          })}
        </NavigationMenu>
      )}
      {full && capacity.byPlan && <PremiumHint>{where} is at the free plan's {capacity.max}-calendar limit.</PremiumHint>}
      {full && !capacity.byPlan && <MenuHint>{where} fits up to {capacity.max} calendars.</MenuHint>}
      {onConnect && (
        <NavigationMenu>
          <NavigationMenuItem>
            <Text size="xs" tone="muted">Connect</Text>
          </NavigationMenuItem>
          {providers.map((provider) => (
            <div
              key={provider.id}
              data-visitors-event={ANALYTICS_EVENTS.calendar_connect_started}
              data-visitors-provider={provider.analyticsProvider}
            >
              <NavigationMenuLinkItem to={provider.to} disabled={atLimit} onClick={connect}>
                <NavigationMenuItemIcon>
                  <ConnectProviderIcon provider={provider} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{provider.label}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing />
              </NavigationMenuLinkItem>
            </div>
          ))}
        </NavigationMenu>
      )}
      {onConnect && atLimit && <PremiumHint>Account limit reached.</PremiumHint>}
    </div>
  );
}
