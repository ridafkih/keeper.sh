import { CalendarDays, CalendarSync, Filter, Settings, LogOut, CalendarPlus } from "lucide-react";
import { FC } from "react";
import KeeperLogo from "@/assets/keeper.svg";
import {
  NavigationMenu,
  NavigationItem,
  NavigationItemIcon,
  NavigationItemLabel,
  NavigationItemRightContent,
} from "@/components/navigation-menu";
import { AccountsPopover } from "@/components/accounts-popover";
import { PageOverlay } from "@/components/page-overlay";

const DashboardPage: FC = () => {
  return (
    <>
      <PageOverlay />
      <div className="flex flex-col gap-12 items-stretch">
      <div className="flex flex-col gap-2 items-stretch">
        <NavigationMenu className="bg-surface-elevated rounded-2xl shadow-xs border border-border overflow-hidden p-0.5">
          <NavigationItem href="/dashboard/accounts/connect">
            <NavigationItemIcon>
              <CalendarPlus className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Connect Calendar Account</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>
        </NavigationMenu>

        <NavigationMenu className="bg-surface-elevated rounded-2xl shadow-xs border border-border overflow-visible p-0.5">
          <AccountsPopover
            accounts={[
              {
                id: '1',
                href: '/dashboard/accounts/1',
                icon: '/integrations/icon-google.svg',
                name: 'Personal',
                email: 'ridafkih@gmail.com',
                eventCount: 142,
                status: 'synced',
              },
              {
                id: '2',
                href: '/dashboard/accounts/2',
                icon: '/integrations/icon-google.svg',
                name: 'Work',
                email: 'rida@ridafkih.dev',
                eventCount: 89,
                status: 'error',
              },
              {
                id: '3',
                href: '/dashboard/accounts/3',
                icon: '/integrations/icon-icloud.svg',
                name: 'Family',
                email: 'rida@icloud.com',
                eventCount: 23,
                status: 'syncing',
              },
              {
                id: '4',
                href: '/dashboard/accounts/4',
                icon: '/integrations/icon-fastmail.svg',
                name: 'Personal',
                email: 'rida@keeper.sh',
                eventCount: 56,
                status: 'synced',
              },
            ]}
          />

          <NavigationItem href="/dashboard/calendars">
            <NavigationItemIcon>
              <CalendarSync className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Calendar Sync</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>

          <NavigationItem href="/dashboard/events">
            <NavigationItemIcon>
              <CalendarDays className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Events</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>

          <NavigationItem href="/dashboard/filters">
            <NavigationItemIcon>
              <Filter className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Global Event Filters</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>

          <NavigationItem href="/dashboard/settings">
            <NavigationItemIcon>
              <Settings className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Account Settings</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>
        </NavigationMenu>

        <NavigationMenu className="bg-surface-elevated rounded-2xl shadow-xs border border-border overflow-hidden p-0.5">
          <NavigationItem href="/dashboard/logout">
            <NavigationItemIcon>
              <LogOut className="text-foreground-muted" size={15} />
              <NavigationItemLabel>Logout</NavigationItemLabel>
            </NavigationItemIcon>
            <NavigationItemRightContent />
          </NavigationItem>
        </NavigationMenu>
      </div>

      <KeeperLogo className="size-8 text-border self-center" />
      </div>
    </>
  );
};

export default DashboardPage;
