import { Heading1, Heading2 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { CalendarGrid } from "../../compositions/calendar-grid/calendar-grid";
import { EventList } from "../../compositions/event-list/event-list";
import { TODAY_EVENTS, TOMORROW_EVENTS } from "../../compositions/event-list/utils/mock-events";

const ALL_EVENTS = [...TODAY_EVENTS, ...TOMORROW_EVENTS];

const DashboardPage = () => (
  <div className="flex flex-col gap-4 pt-16 pb-8">
    <div className="flex flex-col gap-2">
      <Heading1>Welcome, Rida</Heading1>
      <Copy>It&apos;s Friday the 9th and you&apos;ve got 5 events today across 2 calendars.</Copy>
    </div>
    <div className="flex flex-col gap-4">
      <CalendarGrid />
      <EventList events={ALL_EVENTS} />
    </div>
  </div>
);

export default DashboardPage;
