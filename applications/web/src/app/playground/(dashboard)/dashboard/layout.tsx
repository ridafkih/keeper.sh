import type { FC, PropsWithChildren } from "react";
import { Home, List, Calendar, Settings, LogOut } from "lucide-react";
import { Dock, Scaffold, TopNav, TopNavItem } from "@keeper.sh/ui";
import { DockItem } from "../../components/dock";

const DashboardLayout: FC<PropsWithChildren> = ({ children }) => (
  <>
    <Scaffold>
      <div className="flex flex-col pt-8 pb-8">
        <div className="hidden md:block">
          <TopNav>
            <div className="flex items-center gap-px">
              <TopNavItem href="/playground/dashboard" segment={null} icon={<Home size={14} />}>
                Home
              </TopNavItem>
              <TopNavItem href="/playground/dashboard/agenda" segment="agenda" icon={<List size={14} />}>
                Agenda
              </TopNavItem>
              <TopNavItem href="/playground/dashboard/calendars" segment="calendars" icon={<Calendar size={14} />}>
                Calendars
              </TopNavItem>
              <TopNavItem href="/playground/dashboard/settings" segment="settings" icon={<Settings size={14} />}>
                Settings
              </TopNavItem>
            </div>
            <TopNavItem href="/logout" segment="logout" icon={<LogOut size={14} />}>
              Logout
            </TopNavItem>
          </TopNav>
        </div>
        {children}
      </div>
    </Scaffold>
    <Dock className="md:hidden">
      <DockItem href="/playground/dashboard" segment={null} icon="HomeIcon" />
      <DockItem href="/playground/dashboard/agenda" segment="agenda" icon="ListIcon" />
      <DockItem href="/playground/dashboard/calendars" segment="calendars" icon="CalendarsIcon" />
      <DockItem href="/playground/dashboard/settings" segment="settings" icon="BoltIcon" />
      <DockItem href="/logout" segment="logout" icon="LogOut" />
    </Dock>
  </>
);

export default DashboardLayout;
