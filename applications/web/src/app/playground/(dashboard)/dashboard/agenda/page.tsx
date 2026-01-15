import { EventList, Heading1 } from "@keeper.sh/ui";
import { WEEK_EVENTS } from "./utils/mock-events";

const AgendaPage = () => (
  <div className="flex flex-col gap-4">
    <div className="md:hidden mb-4">
      <Heading1>Agenda</Heading1>
    </div>
    <EventList events={WEEK_EVENTS} />
  </div>
);

export default AgendaPage;
