import { Heading1 } from "../../../components/heading";
import { EventList } from "../../../compositions/event-list/event-list";
import { WEEK_EVENTS } from "./utils/mock-events";

const AgendaPage = () => (
  <div className="flex flex-col gap-4 pt-16 pb-8">
    <Heading1>Agenda</Heading1>
    <EventList events={WEEK_EVENTS} />
  </div>
);

export default AgendaPage;
