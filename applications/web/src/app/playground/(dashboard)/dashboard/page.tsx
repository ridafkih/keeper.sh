import { Heading1, Heading2 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { CalendarGrid } from "../../compositions/calendar-grid/calendar-grid";

const DashboardPage = () => (
  <div className="flex flex-col gap-8 py-8">
    <div className="flex flex-col gap-4">
      <Heading1>Home</Heading1>
      <Copy>Welcome, Rida. It&apos;s Thursday the 8th and you&apos;ve got 4 events today across 14 calendars.</Copy>
    </div>
    <div className="flex flex-col gap-4">
      <Heading2>Calendar</Heading2>
      <CalendarGrid />
    </div>
  </div>
);

export default DashboardPage;
