import type { FC, PropsWithChildren } from "react";
import { Dock, Scaffold, TopNav } from "@keeper.sh/ui";
import { DockItem } from "../../components/dock";

const DashboardLayout: FC<PropsWithChildren> = ({ children }) => (
  <>
    <Scaffold>
      <div className="flex flex-col pt-8 pb-8">
        <div className="hidden md:block">
          <TopNav />
        </div>
        {children}
      </div>
    </Scaffold>
    <Dock className="md:hidden">
      <DockItem href="/playground/dashboard" segment={null} icon="HomeIcon" />
      <DockItem href="/playground/dashboard/agenda" segment="agenda" icon="ListIcon" />
      <DockItem href="/playground/dashboard/calendars" segment="calendars" icon="CalendarsIcon" />
      <DockItem href="/playground/dashboard/settings" segment="settings" icon="BoltIcon" />
    </Dock>
  </>
);

export default DashboardLayout;
