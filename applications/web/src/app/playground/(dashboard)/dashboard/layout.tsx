import type { FC, PropsWithChildren } from "react";
import { Dock, DockItem } from "../../components/dock";

const DashboardLayout: FC<PropsWithChildren> = ({ children }) => (
  <>
    {children}
    <Dock>
      <DockItem href="/playground/dashboard" segment={null} icon="HomeIcon" />
      <DockItem href="/playground/dashboard/calendars" segment="calendars" icon="CalendarsIcon" />
      <DockItem href="/playground/dashboard/sync" segment="sync" icon="CalendarSyncIcon" />
      <DockItem href="/playground/dashboard/billing" segment="billing" icon="ReceiptIcon" />
      <DockItem href="/playground/dashboard/settings" segment="settings" icon="BoltIcon" />
    </Dock>
  </>
);

export default DashboardLayout;
