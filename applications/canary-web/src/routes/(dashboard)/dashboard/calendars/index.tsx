import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { Calendar, Link as LinkIcon, AlertTriangle, CalendarPlus } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/navigation-menu";
import { providerIcons } from "../../../../lib/providers";

export const Route = createFileRoute("/(dashboard)/dashboard/calendars/")({
  component: RouteComponent,
});

interface CalendarEntry {
  id: string;
  name: string;
  calendarType: string;
  email?: string;
  provider?: string;
  needsReauthentication?: boolean;
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch");
  return response.json();
};

function ProviderIcon({ provider, calendarType }: { provider?: string; calendarType: string }) {
  if (calendarType === "ical") {
    return <LinkIcon size={15} />;
  }

  const iconPath = provider ? providerIcons[provider] : undefined;

  if (!iconPath) {
    return <Calendar size={15} />;
  }

  return <img src={iconPath} alt="" width={15} height={15} />;
}

function RouteComponent() {
  const { data: calendars = [] } = useSWR<CalendarEntry[]>("/api/sources", fetcher);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        {calendars.map((calendar) => (
          <NavigationMenuItem key={calendar.id} to={`/dashboard/calendars/${calendar.id}`}>
            <NavigationMenuItemIcon>
              <ProviderIcon provider={calendar.provider ?? calendar.calendarType} calendarType={calendar.calendarType} />
              <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing>
              {calendar.needsReauthentication && (
                <AlertTriangle size={14} className="text-amber-500" />
              )}
            </NavigationMenuItemTrailing>
          </NavigationMenuItem>
        ))}
        <NavigationMenuItem to="/dashboard/connect">
          <NavigationMenuItemIcon>
            <CalendarPlus size={15} />
            <NavigationMenuItemLabel>Link Calendar Account</NavigationMenuItemLabel>
          </NavigationMenuItemIcon>
          <NavigationMenuItemTrailing />
        </NavigationMenuItem>
      </NavigationMenu>
    </div>
  );
}
